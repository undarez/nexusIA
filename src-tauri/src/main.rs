#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::path::PathBuf;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    sync::atomic::{AtomicU64, AtomicUsize, Ordering},
    sync::mpsc,
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const OUTPUT_LIMIT_BYTES: usize = 16 * 1024;
const EXECUTION_TIMEOUT: Duration = Duration::from_secs(8);
static NEXT_EVENT_ID: AtomicU64 = AtomicU64::new(1);
static AUDIT_LOG_LOCK: Mutex<()> = Mutex::new(());
static OLLAMA_AGENT_ACTIVE: AtomicUsize = AtomicUsize::new(0);
static OPENAI_AGENT_ACTIVE: AtomicUsize = AtomicUsize::new(0);
static HERMES_AGENT_ACTIVE: AtomicUsize = AtomicUsize::new(0);
const MAX_PARALLEL_AGENT_CALLS: usize = 2;
const AUDIT_LOG_MAX_BYTES: u64 = 1024 * 1024;
static LAST_CPU_TICKS: Mutex<Option<(u64, u64, u64)>> = Mutex::new(None);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemMetrics {
    cpu_percent: f64,
    memory_percent: f64,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
}

#[tauri::command]
fn get_system_metrics() -> Result<SystemMetrics, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::FILETIME,
            System::{
                SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
                Threading::GetSystemTimes,
            },
        };
        let mut memory = MEMORYSTATUSEX::default();
        memory.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if unsafe { GlobalMemoryStatusEx(&mut memory) } == 0 || memory.ullTotalPhys == 0 {
            return Err("Lecture de la mémoire Windows impossible.".to_owned());
        }
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 {
            return Err("Lecture de l’activité CPU Windows impossible.".to_owned());
        }
        let ticks =
            |value: FILETIME| ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64;
        let current = (ticks(idle), ticks(kernel), ticks(user));
        let mut last = LAST_CPU_TICKS
            .lock()
            .map_err(|_| "État métrique indisponible.".to_owned())?;
        let cpu_percent = last
            .replace(current)
            .and_then(|previous| {
                let idle_delta = current.0.saturating_sub(previous.0);
                let total_delta =
                    current.1.saturating_sub(previous.1) + current.2.saturating_sub(previous.2);
                (total_delta > 0).then(|| {
                    ((total_delta.saturating_sub(idle_delta) as f64 / total_delta as f64) * 100.0)
                        .clamp(0.0, 100.0)
                })
            })
            .unwrap_or(0.0);
        let memory_used_bytes = memory.ullTotalPhys.saturating_sub(memory.ullAvailPhys);
        Ok(SystemMetrics {
            cpu_percent,
            memory_percent: memory_used_bytes as f64 / memory.ullTotalPhys as f64 * 100.0,
            memory_used_bytes,
            memory_total_bytes: memory.ullTotalPhys,
        })
    }
    #[cfg(not(windows))]
    Err("Les métriques système locales sont disponibles uniquement sous Windows.".to_owned())
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum TerminalAction {
    GetDate,
    GetProcessSummary,
    GetLocation,
    CmdVersion,
    CmdUser,
    PythonVersion,
    PythonPlatform,
}

impl TerminalAction {
    fn label(self) -> &'static str {
        match self {
            Self::GetDate => "Afficher la date et l’heure",
            Self::GetProcessSummary => "Afficher un résumé des processus (12 maximum)",
            Self::GetLocation => "Afficher le dossier courant",
            Self::CmdVersion => "Afficher la version de Windows (CMD)",
            Self::CmdUser => "Afficher l’utilisateur courant (CMD)",
            Self::PythonVersion => "Afficher la version de Python",
            Self::PythonPlatform => "Afficher la plateforme Python",
        }
    }

    // These scripts are constants. No frontend-provided text is interpolated into PowerShell.
    fn script(self) -> &'static str {
        match self {
            Self::GetDate => "Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'",
            Self::GetProcessSummary => {
                "Get-Process | Select-Object -First 12 Name,Id,CPU | Format-Table -AutoSize"
            }
            Self::GetLocation => "Get-Location | Select-Object -ExpandProperty Path",
            Self::CmdVersion => "ver",
            Self::CmdUser => "whoami",
            Self::PythonVersion => "import sys; print(sys.version)",
            Self::PythonPlatform => "import platform; print(platform.platform())",
        }
    }

    fn runtime(self) -> &'static str {
        match self {
            Self::GetDate | Self::GetProcessSummary | Self::GetLocation => "PowerShell",
            Self::CmdVersion | Self::CmdUser => "CMD",
            Self::PythonVersion | Self::PythonPlatform => "Python",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalAuditEvent {
    event_id: String,
    action: &'static str,
    outcome: &'static str,
    timestamp_ms: u128,
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResult {
    event_id: String,
    action: &'static str,
    output: String,
    exit_code: Option<u32>,
    outcome: &'static str,
    truncated: bool,
    elapsed_ms: u128,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn sanitize_terminal_output(input: &[u8]) -> String {
    let mut clean = Vec::with_capacity(input.len());
    let mut index = 0usize;
    while index < input.len() {
        match input[index] {
            0x1b => {
                index += 1;
                match input.get(index).copied() {
                    Some(b'[') => {
                        index += 1;
                        while index < input.len() {
                            let byte = input[index];
                            index += 1;
                            if (0x40..=0x7e).contains(&byte) {
                                break;
                            }
                        }
                    }
                    Some(b']') | Some(b'P') | Some(b'^') | Some(b'_') => {
                        index += 1;
                        while index < input.len() {
                            if input[index] == 0x07 {
                                index += 1;
                                break;
                            }
                            if input[index] == 0x1b && input.get(index + 1) == Some(&b'\\') {
                                index += 2;
                                break;
                            }
                            index += 1;
                        }
                    }
                    Some(_) => index += 1,
                    None => {}
                }
            }
            b'\r' => {
                if input.get(index + 1) == Some(&b'\n') {
                    index += 2;
                } else {
                    index += 1;
                }
                clean.push(b'\n');
            }
            byte if byte == b'\n' || byte == b'\t' || byte >= 0x20 => {
                clean.push(byte);
                index += 1;
            }
            _ => index += 1,
        }
    }
    String::from_utf8_lossy(&clean).trim().to_owned()
}

fn next_event_id() -> String {
    format!(
        "nexus-{}-{}",
        now_ms(),
        NEXT_EVENT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn audit(
    app: &AppHandle,
    event_id: &str,
    action: &'static str,
    outcome: &'static str,
    detail: Option<String>,
) {
    let event = TerminalAuditEvent {
        event_id: event_id.to_owned(),
        action,
        outcome,
        timestamp_ms: now_ms(),
        detail,
    };
    // Persist only event metadata, rotate the small log, and mirror the event to the UI.
    if let Ok(json) = serde_json::to_string(&event) {
        let _guard = AUDIT_LOG_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let write_result = (|| -> std::io::Result<()> {
            let log_dir = app.path().app_log_dir().map_err(std::io::Error::other)?;
            fs::create_dir_all(&log_dir)?;
            let log_path = log_dir.join("terminal-audit.jsonl");
            if fs::metadata(&log_path)
                .map(|metadata| metadata.len() >= AUDIT_LOG_MAX_BYTES)
                .unwrap_or(false)
            {
                let previous_path = log_dir.join("terminal-audit.previous.jsonl");
                if previous_path.exists() {
                    fs::remove_file(&previous_path)?;
                }
                fs::rename(&log_path, previous_path)?;
            }
            let mut file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)?;
            writeln!(file, "{json}")
        })();
        if let Err(error) = write_result {
            eprintln!("NEXUS_TERMINAL_AUDIT_WRITE_FAILED {error}");
        }
    }
    let _ = app.emit("terminal://audit", event);
}

#[tauri::command]
fn record_terminal_denial(app: AppHandle, action: TerminalAction) {
    audit(&app, &next_event_id(), action.label(), "rejected", None);
}

#[tauri::command]
fn record_terminal_text_rejection(app: AppHandle) {
    audit(
        &app,
        &next_event_id(),
        "Commande PowerShell saisie",
        "rejectedPolicy",
        None,
    );
}

#[tauri::command]
fn open_approved_app(app: AppHandle, app_id: String) -> Result<(), String> {
    let (label, executable) = match app_id.as_str() {
        "calculator" => ("Calculatrice", "calc.exe"),
        "notepad" => ("Bloc-notes", "notepad.exe"),
        "explorer" => ("Explorateur de fichiers", "explorer.exe"),
        "spotify" => ("Spotify", "spotify.exe"),
        "edge" => ("Microsoft Edge", "msedge.exe"),
        "chrome" => ("Google Chrome", "chrome.exe"),
        "vlc" => ("VLC media player", "vlc.exe"),
        _ => {
            audit(
                &app,
                &next_event_id(),
                "Ouverture d’application",
                "rejectedPolicy",
                None,
            );
            return Err("Cette application n’est pas autorisée.".to_owned());
        }
    };

    #[cfg(windows)]
    let result = if app_id == "spotify" {
        std::process::Command::new("explorer.exe")
            .arg("spotify:")
            .spawn()
            .map(|_| ())
    } else {
        std::process::Command::new(executable).spawn().map(|_| ())
    };
    #[cfg(not(windows))]
    let result: Result<(), std::io::Error> = Err(std::io::Error::other(
        "Cette action est disponible uniquement sous Windows.",
    ));

    match result {
        Ok(()) => {
            audit(
                &app,
                &next_event_id(),
                "Ouverture d’application",
                "approvedAndStarted",
                Some(label.to_owned()),
            );
            Ok(())
        }
        Err(error) => {
            audit(
                &app,
                &next_event_id(),
                "Ouverture d’application",
                "failed",
                Some(label.to_owned()),
            );
            Err(format!("Impossible d’ouvrir {label} : {error}"))
        }
    }
}

#[tauri::command]
fn record_companion_app_denial(app: AppHandle, app_id: String) {
    let label = match app_id.as_str() {
        "calculator" => "Calculatrice",
        "notepad" => "Bloc-notes",
        _ => "Application non autorisée",
    };
    audit(
        &app,
        &next_event_id(),
        "Ouverture d’application",
        "rejected",
        Some(label.to_owned()),
    );
}

#[derive(Debug, Deserialize)]
struct OllamaModelEntry {
    name: String,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelEntry>,
}

fn validate_agent_prompt(prompt: &str) -> Result<(), String> {
    if prompt.trim().is_empty() {
        return Err("La demande ne peut pas être vide.".to_owned());
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaAgentInput {
    model: String,
    role: String,
    prompt: String,
    skill_name: Option<String>,
    skill_instructions: Option<String>,
    #[serde(default)]
    enable_hermes_tools: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunResult {
    response: String,
    model: String,
    elapsed_ms: u128,
}

struct AgentSlotGuard(&'static AtomicUsize);

impl AgentSlotGuard {
    fn acquire(counter: &'static AtomicUsize, engine: &str) -> Result<Self, String> {
        let active = counter.fetch_add(1, Ordering::AcqRel);
        if active >= MAX_PARALLEL_AGENT_CALLS {
            counter.fetch_sub(1, Ordering::Release);
            return Err(format!("Deux demandes {engine} fonctionnent déjà en parallèle."));
        }
        Ok(Self(counter))
    }
}

impl Drop for AgentSlotGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}

#[derive(Debug, Deserialize)]
struct OpenAiModelEntry {
    id: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModelEntry>,
}

#[cfg(windows)]
fn openai_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("openai-key.dpapi"))
        .map_err(|error| format!("Dossier de configuration NEXUS indisponible: {error}"))
}

#[cfg(windows)]
fn dpapi_transform(input: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input_len =
        u32::try_from(input.len()).map_err(|_| "Donnée secrète trop longue.".to_owned())?;
    let source = CRYPT_INTEGER_BLOB {
        cbData: input_len,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &source,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &source,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 || output.pbData.is_null() {
        return Err("Windows n’a pas pu protéger ou lire la clé OpenAI.".to_owned());
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(bytes)
}

#[cfg(windows)]
fn save_openai_key(app: &AppHandle, key: String) -> Result<(), String> {
    let key = key.trim();
    if !key.starts_with("sk-") || key.len() > 1024 || key.chars().any(char::is_control) {
        return Err("La clé OpenAI semble invalide. Elle doit commencer par sk- et ne pas contenir de retour à la ligne.".to_owned());
    }
    let encrypted = dpapi_transform(key.as_bytes(), true)?;
    let path = openai_key_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Dossier de configuration NEXUS invalide.".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Création du dossier de configuration impossible: {error}"))?;
    fs::write(&path, encrypted)
        .map_err(|error| format!("Enregistrement chiffré impossible: {error}"))
}

#[cfg(windows)]
fn load_openai_key(app: &AppHandle) -> Result<String, String> {
    let path = openai_key_path(app)?;
    let encrypted =
        fs::read(path).map_err(|_| "Clé OpenAI non configurée dans NEXUS.".to_owned())?;
    if encrypted.is_empty() || encrypted.len() > 16 * 1024 {
        return Err("Fichier de clé OpenAI invalide.".to_owned());
    }
    String::from_utf8(dpapi_transform(&encrypted, false)?)
        .map_err(|_| "Clé OpenAI protégée invalide.".to_owned())
}

#[cfg(not(windows))]
fn save_openai_key(_app: &AppHandle, _key: String) -> Result<(), String> {
    Err("Le stockage sécurisé de clé est disponible uniquement sous Windows.".to_owned())
}

#[cfg(not(windows))]
fn load_openai_key(_app: &AppHandle) -> Result<String, String> {
    Err("Le stockage sécurisé de clé est disponible uniquement sous Windows.".to_owned())
}

#[tauri::command]
async fn save_openai_api_key(app: AppHandle, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_openai_key(&app, key))
        .await
        .map_err(|error| format!("Enregistrement de la clé interrompu: {error}"))?
}

#[tauri::command]
async fn openai_api_key_configured(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || load_openai_key(&app).map(|_| true))
        .await
        .map(|result| result.unwrap_or(false))
        .map_err(|error| format!("Lecture de la configuration OpenAI interrompue: {error}"))
}

#[cfg(windows)]
fn openai_http_request(
    method: &str,
    path: &str,
    key: &str,
    body: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    use std::{
        ffi::c_void,
        ptr::{null, null_mut},
    };
    use windows_sys::Win32::Networking::WinHttp::*;
    struct Handle(*mut c_void);
    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    WinHttpCloseHandle(self.0);
                }
            }
        }
    }
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let agent = wide("NEXUS V4.2");
    let host = wide("api.openai.com");
    let verb = wide(method);
    let path = wide(path);
    let headers = wide(&format!(
        "Authorization: Bearer {key}\r\nContent-Type: application/json\r\n"
    ));
    let session = Handle(unsafe {
        WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            null(),
            null(),
            0,
        )
    });
    if session.0.is_null() {
        return Err("Ouverture HTTPS Windows impossible.".to_owned());
    }
    unsafe {
        WinHttpSetTimeouts(session.0, 5000, 10000, 10000, 120000);
    }
    let connection = Handle(unsafe { WinHttpConnect(session.0, host.as_ptr(), 443, 0) });
    if connection.0.is_null() {
        return Err("Connexion HTTPS OpenAI impossible.".to_owned());
    }
    let request = Handle(unsafe {
        WinHttpOpenRequest(
            connection.0,
            verb.as_ptr(),
            path.as_ptr(),
            null(),
            null(),
            null(),
            WINHTTP_FLAG_SECURE,
        )
    });
    if request.0.is_null() {
        return Err("Préparation de la requête OpenAI impossible.".to_owned());
    }
    let body_ptr = body.map_or(null(), |bytes| bytes.as_ptr().cast::<c_void>());
    let body_len = body.map_or(0, |bytes| bytes.len() as u32);
    let sent = unsafe {
        WinHttpSendRequest(
            request.0,
            headers.as_ptr(),
            u32::MAX,
            body_ptr,
            body_len,
            body_len,
            0,
        )
    };
    if sent == 0 || unsafe { WinHttpReceiveResponse(request.0, null_mut()) } == 0 {
        return Err("Requête HTTPS OpenAI impossible ou expirée.".to_owned());
    }
    let mut status = 0u32;
    let mut status_bytes = std::mem::size_of::<u32>() as u32;
    if unsafe {
        WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            null(),
            (&mut status as *mut u32).cast(),
            &mut status_bytes,
            null_mut(),
        )
    } == 0
    {
        return Err("Statut de réponse OpenAI introuvable.".to_owned());
    }
    if !(200..300).contains(&status) {
        return Err(format!("OpenAI a répondu avec le statut HTTP {status}. Vérifie la clé, le modèle et les droits API."));
    }
    const LIMIT: usize = 256 * 1024;
    let mut response = Vec::new();
    loop {
        let mut available = 0u32;
        if unsafe { WinHttpQueryDataAvailable(request.0, &mut available) } == 0 {
            return Err("Lecture de la réponse OpenAI impossible.".to_owned());
        }
        if available == 0 {
            break;
        }
        if response.len().saturating_add(available as usize) > LIMIT {
            return Err("Réponse OpenAI supérieure à 256 Ko.".to_owned());
        }
        let start = response.len();
        response.resize(start + available as usize, 0);
        let mut received = 0u32;
        if unsafe {
            WinHttpReadData(
                request.0,
                response[start..].as_mut_ptr().cast(),
                available,
                &mut received,
            )
        } == 0
        {
            return Err("Lecture de la réponse OpenAI interrompue.".to_owned());
        }
        response.truncate(start + received as usize);
        if received == 0 {
            break;
        }
    }
    Ok(response)
}

#[cfg(not(windows))]
fn openai_http_request(
    _method: &str,
    _path: &str,
    _key: &str,
    _body: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    Err("La connexion OpenAI sécurisée est disponible uniquement sous Windows.".to_owned())
}

#[tauri::command]
async fn list_openai_models(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let key = load_openai_key(&app)?;
        let response = openai_http_request("GET", "/v1/models", &key, None)?;
        let parsed: OpenAiModelsResponse = serde_json::from_slice(&response)
            .map_err(|error| format!("Liste de modèles OpenAI invalide: {error}"))?;
        let mut models: Vec<String> = parsed
            .data
            .into_iter()
            .map(|model| model.id)
            .filter(|model| model.starts_with("gpt-") && model.len() <= 128)
            .collect();
        models.sort();
        models.dedup();
        Ok(models)
    })
    .await
    .map_err(|error| format!("Lecture des modèles OpenAI interrompue: {error}"))?
}

#[tauri::command]
async fn run_openai_agent(
    app: AppHandle,
    input: OllamaAgentInput,
) -> Result<AgentRunResult, String> {
    let _guard = AgentSlotGuard::acquire(&OPENAI_AGENT_ACTIVE, "OpenAI")?;
    let event_id = next_event_id();
    let metadata = format!("role={}; model={}", input.role, input.model);
    audit(
        &app,
        &event_id,
        "OpenAI Agent",
        "started",
        Some(metadata.clone()),
    );
    let started = Instant::now();
    let app_for_request = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let role_instruction = ollama_agent_role(&input.role)
            .ok_or_else(|| "Rôle d’agent non autorisé.".to_owned())?;
        let model = input.model.trim();
        if !model.starts_with("gpt-") || model.len() > 128 || model.chars().any(char::is_control) {
            return Err("Modèle OpenAI invalide.".to_owned());
        }
        let prompt = input.prompt.trim();
        let skill_name = input.skill_name.unwrap_or_default();
        let skill_instructions = input.skill_instructions.unwrap_or_default();
        validate_agent_prompt(prompt)?;
        let mut system = format!(
            "Tu es l’agent NEXUS « {} ». {} Tu es un assistant de conseil sans outils : tu ne peux ni lancer de commandes, ni lire ou modifier des fichiers, ni accéder au réseau. Réponds en français et indique les hypothèses importantes.",
            input.role, role_instruction
        );
        if !skill_instructions.trim().is_empty() {
            system.push_str("\n\nSkill sélectionné — consignes fournies par l’utilisateur :\n");
            system.push_str(skill_name.trim());
            system.push('\n');
            system.push_str(skill_instructions.trim());
        }
        let key = load_openai_key(&app_for_request)?;
        let body = serde_json::to_vec(&serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": prompt }
            ],
            "max_completion_tokens": 512
        })).map_err(|error| format!("Préparation de la demande OpenAI impossible: {error}"))?;
        let response = openai_http_request("POST", "/v1/chat/completions", &key, Some(&body))?;
        let json: serde_json::Value = serde_json::from_slice(&response)
            .map_err(|error| format!("Réponse OpenAI invalide: {error}"))?;
        let content = json.get("choices")
            .and_then(serde_json::Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(serde_json::Value::as_str)
            .filter(|content| content.len() <= 64 * 1024)
            .ok_or_else(|| "La réponse OpenAI est vide ou dépasse 64 Ko.".to_owned())?;
        Ok(AgentRunResult { response: content.to_owned(), model: model.to_owned(), elapsed_ms: 0 })
    }).await
        .map_err(|error| format!("Traitement OpenAI interrompu: {error}"))
        .and_then(|result| result);
    match result {
        Ok(result) => {
            let elapsed_ms = started.elapsed().as_millis();
            audit(
                &app,
                &event_id,
                "OpenAI Agent",
                "completed",
                Some(format!("{metadata}; elapsedMs={elapsed_ms}")),
            );
            Ok(AgentRunResult {
                elapsed_ms,
                ..result
            })
        }
        Err(error) => {
            audit(
                &app,
                &event_id,
                "OpenAI Agent",
                "failed",
                Some(error.clone()),
            );
            Err(error)
        }
    }
}

fn ollama_agent_role(role: &str) -> Option<&'static str> {
    match role {
        "Project Manager" => Some("Planifie les tâches, clarifie les dépendances et propose des étapes vérifiables."),
        "UI / UX Designer" => Some("Conçois des parcours et interfaces accessibles, cohérents et faciles à utiliser."),
        "Frontend Developer" => Some("Propose des solutions frontend maintenables, accessibles et compatibles avec le projet."),
        "Android & Smart TV" => Some("Conseille sur Android, Kotlin, Jetpack Compose, ADB et les interfaces TV."),
        "Terminal Operator" => Some("Explique les opérations locales et propose des commandes à examiner; tu ne peux pas les exécuter."),
        "Security Sentinel" => Some("Repère les risques, limites les privilèges et propose des mesures de réduction concrètes."),
        "Compagnon NEXUS-01" => Some("Tu es le compagnon visuel de NEXUS. Discute naturellement en français, aide à organiser les demandes et indique clairement quand une action Windows doit être confirmée dans l’interface. Ne prétends jamais avoir exécuté une action sans retour du système."),
        _ => None,
    }
}

fn run_ollama_agent_sync(input: OllamaAgentInput) -> Result<AgentRunResult, String> {
    let role_instruction =
        ollama_agent_role(&input.role).ok_or_else(|| "Rôle d’agent non autorisé.".to_owned())?;
    let model = input.model.trim();
    if model.is_empty()
        || model.len() > 128
        || model.chars().any(|character| character.is_control())
    {
        return Err("Identifiant de modèle invalide.".to_owned());
    }
    let prompt = input.prompt.trim();
    let skill_name = input.skill_name.unwrap_or_default();
    let skill_instructions = input.skill_instructions.unwrap_or_default();
    validate_agent_prompt(prompt)?;

    let mut system = format!(
        "Tu es l’agent NEXUS « {} ». {} Tu es un assistant de conseil sans outils : tu ne peux ni lancer de commandes, ni lire ou modifier des fichiers, ni accéder au réseau. Réponds en français, indique les hypothèses importantes et demande une validation humaine avant toute action réelle.",
        input.role, role_instruction
    );
    if !skill_instructions.trim().is_empty() {
        system.push_str("\n\nSkill sélectionné — consignes fournies par l’utilisateur :\n");
        system.push_str(skill_name.trim());
        system.push_str("\n");
        system.push_str(skill_instructions.trim());
    }

    let request_body = serde_json::to_vec(&serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt }
        ],
        "stream": false,
        "keep_alive": "5m",
        "options": { "num_predict": 512, "temperature": 0.2 }
    }))
    .map_err(|error| format!("Préparation de la demande Ollama impossible: {error}"))?;

    const RESPONSE_LIMIT_BYTES: usize = 256 * 1024;
    let address: SocketAddr = "127.0.0.1:11434".parse().expect("fixed socket address");
    let timeout = Duration::from_secs(180);
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|error| format!("Ollama local indisponible: {error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("Délai de lecture Ollama impossible: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("Délai d’écriture Ollama impossible: {error}"))?;
    write!(
        stream,
        "POST /api/chat HTTP/1.1\r\nHost: 127.0.0.1:11434\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        request_body.len()
    )
    .and_then(|_| stream.write_all(&request_body))
    .map_err(|error| format!("Envoi à Ollama impossible: {error}"))?;

    let mut response = Vec::with_capacity(8192);
    stream
        .take((RESPONSE_LIMIT_BYTES + 1) as u64)
        .read_to_end(&mut response)
        .map_err(|error| format!("Lecture de la réponse Ollama impossible: {error}"))?;
    if response.len() > RESPONSE_LIMIT_BYTES {
        return Err("La réponse de l’agent dépasse 256 Ko.".to_owned());
    }
    let header_end = response
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .ok_or_else(|| "Réponse HTTP Ollama invalide.".to_owned())?;
    let headers = String::from_utf8_lossy(&response[..header_end]);
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return Err("Ollama n’a pas accepté la demande de l’agent.".to_owned());
    }
    let raw_body = &response[header_end + 4..];
    let body = if headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        decode_chunked_body(raw_body, RESPONSE_LIMIT_BYTES)?
    } else {
        raw_body.to_vec()
    };
    let json: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Réponse JSON Ollama invalide: {error}"))?;
    let content = json
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .filter(|content| content.len() <= 64 * 1024)
        .ok_or_else(|| "La réponse Ollama est vide ou dépasse 64 Ko.".to_owned())?;

    Ok(AgentRunResult {
        response: content.to_owned(),
        model: model.to_owned(),
        elapsed_ms: 0,
    })
}

#[tauri::command]
async fn run_ollama_agent(
    app: AppHandle,
    input: OllamaAgentInput,
) -> Result<AgentRunResult, String> {
    let _guard = AgentSlotGuard::acquire(&OLLAMA_AGENT_ACTIVE, "Ollama")?;
    let event_id = next_event_id();
    let metadata = Some(format!("role={}; model={}", input.role, input.model));
    audit(&app, &event_id, "Ollama Agent", "started", metadata.clone());
    let started = Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || run_ollama_agent_sync(input))
        .await
        .map_err(|error| format!("Traitement de l’agent interrompu: {error}"))
        .and_then(|result| result);
    match result {
        Ok(result) => {
            let elapsed_ms = started.elapsed().as_millis();
            audit(
                &app,
                &event_id,
                "Ollama Agent",
                "completed",
                Some(format!(
                    "{}; elapsedMs={elapsed_ms}",
                    metadata.unwrap_or_default()
                )),
            );
            Ok(AgentRunResult {
                elapsed_ms,
                ..result
            })
        }
        Err(error) => {
            audit(
                &app,
                &event_id,
                "Ollama Agent",
                "failed",
                Some(error.clone()),
            );
            Err(error)
        }
    }
}

#[tauri::command]
async fn list_ollama_models() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let address: SocketAddr = "127.0.0.1:11434".parse().expect("fixed socket address");
        let timeout = Duration::from_secs(2);
        let mut stream = TcpStream::connect_timeout(&address, timeout)
            .map_err(|error| format!("Ollama local indisponible: {error}"))?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|error| format!("Délai de lecture Ollama impossible: {error}"))?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|error| format!("Délai d’écriture Ollama impossible: {error}"))?;
        stream
            .write_all(
                b"GET /api/tags HTTP/1.1\r\nHost: 127.0.0.1:11434\r\nConnection: close\r\n\r\n",
            )
            .map_err(|error| format!("Requête locale Ollama impossible: {error}"))?;

        const RESPONSE_LIMIT_BYTES: usize = 256 * 1024;
        let mut response = Vec::with_capacity(8192);
        stream
            .take((RESPONSE_LIMIT_BYTES + 1) as u64)
            .read_to_end(&mut response)
            .map_err(|error| format!("Lecture de la réponse Ollama impossible: {error}"))?;
        if response.len() > RESPONSE_LIMIT_BYTES {
            return Err("La réponse d’Ollama dépasse la limite de 256 Ko.".to_owned());
        }
        let response = String::from_utf8_lossy(&response);
        let (headers, body) = response
            .split_once("\r\n\r\n")
            .ok_or_else(|| "Réponse HTTP Ollama invalide.".to_owned())?;
        if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
            return Err("Ollama a refusé la lecture de ses modèles.".to_owned());
        }
        if headers
            .to_ascii_lowercase()
            .contains("transfer-encoding: chunked")
        {
            return Err("Réponse Ollama en blocs non prise en charge.".to_owned());
        }
        let parsed: OllamaTagsResponse = serde_json::from_str(body)
            .map_err(|error| format!("Liste de modèles Ollama invalide: {error}"))?;
        let mut models: Vec<String> = parsed
            .models
            .into_iter()
            .map(|model| model.name)
            .filter(|name| !name.is_empty() && name.len() <= 128)
            .collect();
        models.sort();
        models.dedup();
        Ok(models)
    })
    .await
    .map_err(|error| format!("Lecture des modèles Ollama interrompue: {error}"))?
}

fn decode_chunked_body(body: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let mut decoded = Vec::new();
    let mut cursor = 0usize;
    loop {
        let line_end = body[cursor..]
            .windows(2)
            .position(|pair| pair == b"\r\n")
            .map(|offset| cursor + offset)
            .ok_or_else(|| "Réponse Hermes en blocs invalide.".to_owned())?;
        let size_text = std::str::from_utf8(&body[cursor..line_end])
            .map_err(|_| "Taille de bloc Hermes invalide.".to_owned())?
            .split(';')
            .next()
            .unwrap_or_default()
            .trim();
        let size = usize::from_str_radix(size_text, 16)
            .map_err(|_| "Taille de bloc Hermes invalide.".to_owned())?;
        cursor = line_end + 2;
        if size == 0 {
            return Ok(decoded);
        }
        let end = cursor
            .checked_add(size)
            .ok_or_else(|| "Réponse Hermes trop volumineuse.".to_owned())?;
        if end + 2 > body.len() || decoded.len().saturating_add(size) > limit {
            return Err("Réponse Hermes tronquée ou supérieure à 64 Ko.".to_owned());
        }
        decoded.extend_from_slice(&body[cursor..end]);
        cursor = end + 2;
    }
}

fn hermes_api_request(
    method: &str,
    path: &str,
    body: Option<&[u8]>,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Dossier de configuration Hermes introuvable.".to_owned())?;
    let env_contents = fs::read_to_string(
        std::path::Path::new(&local_app_data)
            .join("hermes")
            .join(".env"),
    )
    .map_err(|_| "Fichier local d’authentification Hermes introuvable.".to_owned())?;
    let api_key = env_contents
        .lines()
        .find_map(|line| line.strip_prefix("API_SERVER_KEY="))
        .map(|value| value.trim().trim_matches(['"', '\'']))
        .filter(|value| {
            !value.is_empty() && value.len() <= 4096 && !value.chars().any(char::is_control)
        })
        .ok_or_else(|| "Clé du serveur Hermes absente ou invalide.".to_owned())?;
    let address: SocketAddr = "127.0.0.1:8642".parse().expect("fixed socket address");
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|error| format!("Gateway Hermes locale indisponible: {error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("Délai de lecture Hermes impossible: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("Délai d’écriture Hermes impossible: {error}"))?;
    let body = body.unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:8642\r\nAuthorization: Bearer {api_key}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .and_then(|_| stream.write_all(body))
        .map_err(|error| format!("Requête Hermes impossible: {error}"))?;
    const RESPONSE_LIMIT_BYTES: usize = 256 * 1024;
    let mut response = Vec::with_capacity(8192);
    stream
        .take((RESPONSE_LIMIT_BYTES + 1) as u64)
        .read_to_end(&mut response)
        .map_err(|error| format!("Lecture de la réponse Hermes impossible: {error}"))?;
    if response.len() > RESPONSE_LIMIT_BYTES {
        return Err("Réponse Hermes supérieure à 256 Ko.".to_owned());
    }
    let header_end = response
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .ok_or_else(|| "Réponse HTTP Hermes invalide.".to_owned())?;
    let headers = String::from_utf8_lossy(&response[..header_end]);
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return Err(
            "Hermes a refusé la requête. Vérifie son état et sa clé API locale.".to_owned(),
        );
    }
    let raw_body = &response[header_end + 4..];
    if headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        decode_chunked_body(raw_body, RESPONSE_LIMIT_BYTES)
    } else {
        Ok(raw_body.to_vec())
    }
}

#[derive(Debug, Deserialize)]
struct HermesToolsetEntry {
    name: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
struct HermesToolsetsResponse {
    data: Vec<HermesToolsetEntry>,
}

fn read_hermes_enabled_toolsets() -> Result<Vec<String>, String> {
    let response = hermes_api_request("GET", "/v1/toolsets", None, Duration::from_secs(4))?;
    let parsed: HermesToolsetsResponse = serde_json::from_slice(&response)
        .map_err(|error| format!("Liste des outils Hermes invalide: {error}"))?;
    Ok(parsed
        .data
        .into_iter()
        .filter(|toolset| toolset.enabled)
        .map(|toolset| toolset.name)
        .collect())
}

#[tauri::command]
async fn hermes_text_only_status() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(read_hermes_enabled_toolsets)
        .await
        .map_err(|error| format!("Vérification de sécurité Hermes interrompue: {error}"))?
}

fn run_hermes_agent_sync(input: OllamaAgentInput) -> Result<AgentRunResult, String> {
    let active_toolsets = read_hermes_enabled_toolsets()?;
    if !active_toolsets.is_empty() && !input.enable_hermes_tools {
        return Err(format!("Hermes dispose de toolsets API actifs ({}). Autorise explicitement leur usage pour cette demande dans NEXUS, ou désactive-les côté API Server.", active_toolsets.join(", ")));
    }
    let role_instruction =
        ollama_agent_role(&input.role).ok_or_else(|| "Rôle d’agent non autorisé.".to_owned())?;
    let model = input.model.trim();
    if model.is_empty() || model.len() > 128 || model.chars().any(char::is_control) {
        return Err("Identifiant de modèle Hermes invalide.".to_owned());
    }
    let prompt = input.prompt.trim();
    let skill_name = input.skill_name.unwrap_or_default();
    let skill_instructions = input.skill_instructions.unwrap_or_default();
    validate_agent_prompt(prompt)?;
    let mut system = if input.enable_hermes_tools {
        format!("Tu es l’agent NEXUS « {} ». {} Réponds en français. Les outils Hermes sont disponibles pour cette demande explicitement autorisée. Utilise-les uniquement pour accomplir la demande de l’utilisateur; n’étends pas la tâche et explique les actions réalisées.", input.role, role_instruction)
    } else {
        format!("Tu es l’agent NEXUS « {} ». {} Réponds en français. Tu es utilisé depuis NEXUS sans outils pour cette demande : ne tente aucune action réelle.", input.role, role_instruction)
    };
    if !skill_instructions.trim().is_empty() {
        system.push_str("\n\nSkill sélectionné — consignes fournies par l’utilisateur :\n");
        system.push_str(skill_name.trim());
        system.push('\n');
        system.push_str(skill_instructions.trim());
    }
    let request = serde_json::to_vec(&serde_json::json!({
        "model": model,
        "messages": [{"role":"system","content":system},{"role":"user","content":prompt}],
        "stream": false
    }))
    .map_err(|error| format!("Préparation de la demande Hermes impossible: {error}"))?;
    let started = Instant::now();
    let response = hermes_api_request(
        "POST",
        "/v1/chat/completions",
        Some(&request),
        Duration::from_secs(180),
    )?;
    let json: serde_json::Value = serde_json::from_slice(&response)
        .map_err(|error| format!("Réponse Hermes invalide: {error}"))?;
    let content = json
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .filter(|content| content.len() <= 64 * 1024)
        .ok_or_else(|| "La réponse Hermes est vide ou dépasse 64 Ko.".to_owned())?;
    Ok(AgentRunResult {
        response: content.to_owned(),
        model: model.to_owned(),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
async fn run_hermes_agent(
    app: AppHandle,
    input: OllamaAgentInput,
) -> Result<AgentRunResult, String> {
    let _guard = AgentSlotGuard::acquire(&HERMES_AGENT_ACTIVE, "Hermes")?;
    let event_id = next_event_id();
    let metadata = Some(format!("role={}; model={}", input.role, input.model));
    audit(&app, &event_id, "Hermes Agent", "started", metadata.clone());
    let result = tauri::async_runtime::spawn_blocking(move || run_hermes_agent_sync(input))
        .await
        .map_err(|error| format!("Traitement Hermes interrompu: {error}"))
        .and_then(|result| result);
    match result {
        Ok(value) => {
            audit(&app, &event_id, "Hermes Agent", "completed", metadata);
            Ok(value)
        }
        Err(error) => {
            audit(
                &app,
                &event_id,
                "Hermes Agent",
                "failed",
                Some(error.clone()),
            );
            Err(error)
        }
    }
}

fn read_hermes_models() -> Result<Vec<String>, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Dossier de configuration Hermes introuvable.".to_owned())?;
    let env_path = std::path::Path::new(&local_app_data)
        .join("hermes")
        .join(".env");
    let env_contents = fs::read_to_string(&env_path)
        .map_err(|_| "Fichier local d’authentification Hermes introuvable.".to_owned())?;
    let api_key = env_contents
        .lines()
        .find_map(|line| line.strip_prefix("API_SERVER_KEY="))
        .map(|value| value.trim().trim_matches(['"', '\'']))
        .filter(|value| !value.is_empty() && value.len() <= 4096)
        .ok_or_else(|| "Clé du serveur Hermes absente ou invalide.".to_owned())?;
    if api_key.chars().any(char::is_control) {
        return Err("Clé du serveur Hermes invalide.".to_owned());
    }

    let address: SocketAddr = "127.0.0.1:8642".parse().expect("fixed socket address");
    let timeout = Duration::from_secs(3);
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("Gateway Hermes local indisponible: {error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("Délai de lecture Hermes impossible: {error}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| format!("Délai d’écriture Hermes impossible: {error}"))?;
    let request = format!(
        "GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:8642\r\nAuthorization: Bearer {api_key}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Requête locale Hermes impossible: {error}"))?;

    const RESPONSE_LIMIT_BYTES: usize = 64 * 1024;
    let mut response = Vec::with_capacity(4096);
    stream
        .take((RESPONSE_LIMIT_BYTES + 1) as u64)
        .read_to_end(&mut response)
        .map_err(|error| format!("Lecture de la réponse Hermes impossible: {error}"))?;
    if response.len() > RESPONSE_LIMIT_BYTES {
        return Err("Réponse Hermes supérieure à 64 Ko.".to_owned());
    }
    let header_end = response
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .ok_or_else(|| "Réponse HTTP Hermes invalide.".to_owned())?;
    let headers = String::from_utf8_lossy(&response[..header_end]);
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return Err("Hermes a refusé la lecture de sa liste de modèles.".to_owned());
    }
    let raw_body = &response[header_end + 4..];
    let body = if headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        decode_chunked_body(raw_body, RESPONSE_LIMIT_BYTES)?
    } else {
        raw_body.to_vec()
    };
    let json: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|error| format!("Réponse Hermes invalide: {error}"))?;
    let mut models: Vec<String> = json
        .get("data")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "La réponse Hermes ne contient pas de liste de modèles.".to_owned())?
        .iter()
        .filter_map(|entry| entry.get("id").and_then(serde_json::Value::as_str))
        .filter(|name| !name.is_empty() && name.len() <= 128)
        .map(str::to_owned)
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

#[tauri::command]
async fn list_hermes_models() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(read_hermes_models)
        .await
        .map_err(|error| format!("Lecture des modèles Hermes interrompue: {error}"))?
}

fn validate_device_ip(host: &str) -> Result<std::net::Ipv4Addr, String> {
    let ip: std::net::Ipv4Addr = host
        .trim()
        .parse()
        .map_err(|_| "Saisis une adresse IPv4 locale valide.".to_owned())?;
    let octets = ip.octets();
    if octets[0] != 192 || octets[1] != 168 || octets[2] != 1 || !(2..=254).contains(&octets[3]) {
        return Err("NEXUS teste uniquement les appareils de ton réseau Bbox 192.168.1.0/24 (adresses .2 à .254).".to_owned());
    }
    Ok(ip)
}

#[cfg(windows)]
fn ping_local_ip(host: &str) -> Result<bool, String> {
    let ip = validate_device_ip(host)?;
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_owned());
    let ping_exe = std::path::Path::new(&system_root)
        .join("System32")
        .join("ping.exe");
    let mut child = std::process::Command::new(ping_exe)
        .args(["-n", "1", "-w", "1200", "-4", &ip.to_string()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| format!("Test réseau local impossible: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Surveillance du test réseau impossible: {error}"))?
        {
            return Ok(status.success());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Le test réseau a dépassé 3 secondes et a été arrêté.".to_owned());
        }
        thread::sleep(Duration::from_millis(40));
    }
}

#[cfg(not(windows))]
fn ping_local_ip(host: &str) -> Result<bool, String> {
    let _ = validate_device_ip(host)?;
    Err("Le test réseau Windows est disponible uniquement dans l’application Tauri.".to_owned())
}

#[tauri::command]
async fn check_lan_device(app: AppHandle, host: String) -> Result<bool, String> {
    let ip = validate_device_ip(&host)?;
    let event_id = next_event_id();
    audit(
        &app,
        &event_id,
        "Test appareil LAN",
        "started",
        Some(format!("ip={ip}")),
    );
    let result = tauri::async_runtime::spawn_blocking(move || ping_local_ip(&ip.to_string()))
        .await
        .map_err(|error| format!("Test réseau local interrompu: {error}"))?;
    match result {
        Ok(reachable) => {
            audit(
                &app,
                &event_id,
                "Test appareil LAN",
                if reachable {
                    "reachable"
                } else {
                    "notReachable"
                },
                Some(format!("ip={ip}")),
            );
            Ok(reachable)
        }
        Err(error) => {
            audit(
                &app,
                &event_id,
                "Test appareil LAN",
                "failed",
                Some(format!("ip={ip}; {error}")),
            );
            Err(error)
        }
    }
}

#[tauri::command]
async fn execute_terminal_action(
    app: AppHandle,
    action: TerminalAction,
    running: tauri::State<'_, std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<TerminalResult, String> {
    let event_id = next_event_id();
    let action_label = action.label();
    if running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        audit(&app, &event_id, action_label, "deniedBusy", None);
        return Err("Une action PowerShell est déjà en cours.".to_owned());
    }
    let _run_guard = RunGuard(running.inner().clone());
    let audit_id = event_id.clone();
    audit(&app, &event_id, action_label, "approved", None);
    audit(&app, &event_id, action_label, "started", None);

    let started = Instant::now();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        run_terminal_runtime(action, event_id, started)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            let detail = format!("Échec du worker terminal: {error}");
            audit(
                &app,
                &audit_id,
                action_label,
                "failed",
                Some(detail.clone()),
            );
            return Err(detail);
        }
    };

    match &result {
        Ok(value) => audit(
            &app,
            &value.event_id,
            value.action,
            value.outcome,
            Some(format!(
                "exitCode={:?}; truncated={}; elapsedMs={}",
                value.exit_code, value.truncated, value.elapsed_ms
            )),
        ),
        Err(error) => audit(&app, &audit_id, action_label, "failed", Some(error.clone())),
    }
    result
}

struct RunGuard(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl Drop for RunGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[cfg(windows)]
fn run_terminal_runtime(
    action: TerminalAction,
    event_id: String,
    started: Instant,
) -> Result<TerminalResult, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Ouverture ConPTY impossible: {error}"))?;

    let command = match action.runtime() {
        "PowerShell" => {
            let mut command = CommandBuilder::new("powershell.exe");
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                action.script(),
            ]);
            command
        }
        "CMD" => {
            let mut command = CommandBuilder::new("cmd.exe");
            command.args(["/d", "/q", "/c", action.script()]);
            command
        }
        "Python" => {
            let mut command = CommandBuilder::new("python.exe");
            command.args(["-c", action.script()]);
            command
        }
        _ => return Err("Runtime local non autorisé.".to_owned()),
    };
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Démarrage PowerShell impossible: {error}"))?;
    drop(pair.slave);
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Écriture ConPTY impossible: {error}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Lecture ConPTY impossible: {error}"))?;
    let (sender, receiver) = mpsc::sync_channel::<Vec<u8>>(4);

    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut carry = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => {
                    if !carry.is_empty() {
                        let _ = sender.send(carry);
                    }
                    break;
                }
                Ok(count) => {
                    let mut data = std::mem::take(&mut carry);
                    data.extend_from_slice(&buffer[..count]);
                    let mut clean = Vec::with_capacity(data.len());
                    let mut index = 0;
                    while index + 4 <= data.len() {
                        if &data[index..index + 4] == b"\x1b[6n" {
                            let _ = writer.write_all(b"\x1b[1;1R");
                            let _ = writer.flush();
                            index += 4;
                        } else {
                            clean.push(data[index]);
                            index += 1;
                        }
                    }
                    carry.extend_from_slice(&data[index..]);
                    if !clean.is_empty() && sender.send(clean).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let deadline = started + EXECUTION_TIMEOUT;
    let mut output = Vec::with_capacity(OUTPUT_LIMIT_BYTES);
    let mut truncated = false;
    let mut outcome = "completed";
    let mut exit_code = None;
    let mut child_exited = false;
    while !child_exited {
        if Instant::now() >= deadline && !child_exited {
            outcome = "timeout";
            child.kill().map_err(|error| {
                format!("Arrêt PowerShell après expiration impossible: {error}")
            })?;
            child
                .wait()
                .map_err(|error| format!("Attente de l’arrêt PowerShell impossible: {error}"))?;
            break;
        }

        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => {
                let remaining = OUTPUT_LIMIT_BYTES.saturating_sub(output.len());
                let accepted = remaining.min(chunk.len());
                output.extend_from_slice(&chunk[..accepted]);
                if accepted < chunk.len() {
                    truncated = true;
                    outcome = "outputLimit";
                    child.kill().map_err(|error| {
                        format!("Arrêt PowerShell après dépassement de sortie impossible: {error}")
                    })?;
                    child.wait().map_err(|error| {
                        format!("Attente de l’arrêt PowerShell impossible: {error}")
                    })?;
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        if !child_exited {
            if let Some(status) = child
                .try_wait()
                .map_err(|error| format!("Surveillance PowerShell impossible: {error}"))?
            {
                exit_code = Some(status.exit_code());
                child_exited = true;
            }
        }
    }

    // ConPTY's cloned read handle can stay open briefly after PowerShell exits.
    // Drain output for one bounded grace interval, then return instead of waiting
    // forever for EOF from the pseudo-console pipe.
    while let Ok(chunk) = receiver.recv_timeout(Duration::from_millis(100)) {
        let remaining = OUTPUT_LIMIT_BYTES.saturating_sub(output.len());
        let accepted = remaining.min(chunk.len());
        output.extend_from_slice(&chunk[..accepted]);
        if accepted < chunk.len() {
            truncated = true;
            outcome = "outputLimit";
            break;
        }
    }

    if outcome == "completed" && exit_code.is_none() {
        exit_code = child
            .try_wait()
            .ok()
            .flatten()
            .map(|status| status.exit_code());
    }

    Ok(TerminalResult {
        event_id,
        action: action.label(),
        output: sanitize_terminal_output(&output),
        exit_code,
        outcome,
        truncated,
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[cfg(not(windows))]
fn run_terminal_runtime(
    _action: TerminalAction,
    _event_id: String,
    _started: Instant,
) -> Result<TerminalResult, String> {
    Err("Le terminal ConPTY est disponible uniquement sous Windows.".to_owned())
}

fn main() {
    tauri::Builder::default()
        .manage(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(
            false,
        )))
        .invoke_handler(tauri::generate_handler![
            execute_terminal_action,
            get_system_metrics,
            record_terminal_denial,
            record_terminal_text_rejection,
            open_approved_app,
            record_companion_app_denial,
            list_ollama_models,
            list_hermes_models,
            hermes_text_only_status,
            run_hermes_agent,
            run_ollama_agent,
            list_openai_models,
            run_openai_agent,
            save_openai_api_key,
            openai_api_key_configured,
            check_lan_device
        ])
        .run(tauri::generate_context!())
        .expect("error while running NEXUS");
}
