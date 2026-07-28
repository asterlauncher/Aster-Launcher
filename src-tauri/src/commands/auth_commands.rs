use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    auth::{callback, microsoft, now_unix, AuthState, PendingLogin},
    errors::{AuthError, AuthErrorPayload},
    models::{
        account::{PublicAccount, SessionState},
        auth::{AuthProgress, AuthStart, AuthStatus, AuthStatusState},
    },
};

type CommandResult<T> = Result<T, AuthErrorPayload>;

#[tauri::command]
pub async fn begin_microsoft_login(
    app: AppHandle,
    state: State<'_, AuthState>,
) -> CommandResult<AuthStart> {
    let result = begin_login(&app, &state).await;
    if let Err(error) = &result {
        emit_failure(&app, error.clone());
    }
    result
}

async fn begin_login(app: &AppHandle, state: &State<'_, AuthState>) -> CommandResult<AuthStart> {
    let client_id = state.service.client_id().map_err(AuthErrorPayload::from)?;
    let pkce = microsoft::generate_pkce().map_err(AuthErrorPayload::from)?;
    let oauth_state = microsoft::generate_state().map_err(AuthErrorPayload::from)?;
    let callback = callback::start_callback_listener()
        .await
        .map_err(AuthErrorPayload::from)?;
    let authorization_url = microsoft::authorization_url(
        client_id,
        &callback.redirect_uri,
        &oauth_state,
        &pkce.challenge,
    )
    .map_err(AuthErrorPayload::from)?;

    if open::that_detached(&authorization_url).is_err() {
        callback.task.abort();
        return Err(AuthErrorPayload::from(AuthError::MicrosoftAuthentication));
    }

    let request_id = Uuid::new_v4().to_string();
    let expires_at = now_unix().saturating_add(300);
    let pending = PendingLogin::from_callback(
        request_id.clone(),
        oauth_state,
        pkce.verifier,
        expires_at,
        callback,
    );
    let mut slot = state.pending.lock().await;
    if let Some(previous) = slot.replace(pending) {
        previous.callback_task.abort();
    }
    drop(slot);

    emit_progress(app, "auth://browser-opened", "browser-opened");
    Ok(AuthStart {
        request_id,
        expires_at,
    })
}

#[tauri::command]
pub async fn complete_microsoft_login(
    request_id: String,
    app: AppHandle,
    state: State<'_, AuthState>,
) -> CommandResult<PublicAccount> {
    let pending = {
        let mut slot = state.pending.lock().await;
        let Some(pending) = slot.take() else {
            let error = AuthErrorPayload::from(AuthError::SessionExpired);
            emit_failure(&app, error.clone());
            return Err(error);
        };
        if pending.request_id != request_id {
            *slot = Some(pending);
            let error = AuthErrorPayload::from(AuthError::InvalidOAuthState);
            emit_failure(&app, error.clone());
            return Err(error);
        }
        pending
    };

    if now_unix() > pending.expires_at {
        pending.callback_task.abort();
        let error = AuthErrorPayload::from(AuthError::CallbackTimeout);
        emit_failure(&app, error.clone());
        return Err(error);
    }

    let PendingLogin {
        state: expected_state,
        verifier,
        redirect_uri,
        callback_receiver,
        callback_task,
        ..
    } = pending;

    let callback = match callback_receiver.await {
        Ok(result) => result,
        Err(_) => Err(AuthError::CallbackListener),
    };
    let _ = callback_task.await;
    let callback = match callback {
        Ok(callback) => callback,
        Err(error) => {
            let payload = AuthErrorPayload::from(error);
            emit_failure(&app, payload.clone());
            return Err(payload);
        }
    };
    emit_progress(&app, "auth://callback-received", "callback-received");

    let progress_app = app.clone();
    let outcome = state
        .service
        .authenticate_code(
            callback,
            &expected_state,
            &verifier,
            &redirect_uri,
            move |stage| {
                let event = match stage {
                    "xbox-authenticating" => "auth://xbox-authenticating",
                    "minecraft-authenticating" => "auth://minecraft-authenticating",
                    "profile-loading" => "auth://profile-loading",
                    _ => return,
                };
                emit_progress(&progress_app, event, stage);
            },
        )
        .await;

    match outcome {
        Ok(outcome) => {
            if outcome.skin_warning {
                emit_progress(&app, "auth://skin-warning", "skin-warning");
            }
            emit_progress(&app, "auth://authenticated", "authenticated");
            Ok(outcome.account)
        }
        Err(error) => {
            let payload = AuthErrorPayload::from(error);
            emit_failure(&app, payload.clone());
            Err(payload)
        }
    }
}

#[tauri::command]
pub async fn get_active_account(
    app: AppHandle,
    state: State<'_, AuthState>,
) -> CommandResult<Option<PublicAccount>> {
    match state.service.get_or_refresh_active().await {
        Ok(account) => {
            if account.is_some() {
                emit_progress(&app, "auth://authenticated", "authenticated");
            }
            Ok(account)
        }
        Err(error) => {
            let payload = AuthErrorPayload::from(error);
            emit_failure(&app, payload.clone());
            Err(payload)
        }
    }
}

#[tauri::command]
pub async fn refresh_active_account(
    app: AppHandle,
    state: State<'_, AuthState>,
) -> CommandResult<PublicAccount> {
    match state.service.refresh_active().await {
        Ok(account) => {
            emit_progress(&app, "auth://authenticated", "authenticated");
            Ok(account)
        }
        Err(error) => {
            let payload = AuthErrorPayload::from(error);
            emit_failure(&app, payload.clone());
            Err(payload)
        }
    }
}

#[tauri::command]
pub async fn sign_out(app: AppHandle, state: State<'_, AuthState>) -> CommandResult<()> {
    if let Some(pending) = state.pending.lock().await.take() {
        pending.callback_task.abort();
    }
    state
        .service
        .sign_out()
        .await
        .map_err(AuthErrorPayload::from)?;
    emit_progress(&app, "auth://signed-out", "signed-out");
    Ok(())
}

#[tauri::command]
pub async fn get_auth_status(state: State<'_, AuthState>) -> CommandResult<AuthStatus> {
    if state.pending.lock().await.is_some() {
        return Ok(AuthStatus {
            state: AuthStatusState::Authenticating,
            account: None,
        });
    }

    let active = state
        .service
        .active_without_refresh()
        .await
        .map_err(AuthErrorPayload::from)?;
    let Some(mut active) = active else {
        return Ok(AuthStatus {
            state: AuthStatusState::SignedOut,
            account: None,
        });
    };

    if active.minecraft_token_expired(now_unix(), 0) {
        active.account.session_state = SessionState::Expired;
        Ok(AuthStatus {
            state: AuthStatusState::Expired,
            account: Some(active.account),
        })
    } else {
        Ok(AuthStatus {
            state: AuthStatusState::Authenticated,
            account: Some(active.account),
        })
    }
}

fn emit_progress(app: &AppHandle, event: &str, stage: &str) {
    let _ = app.emit(
        event,
        AuthProgress {
            stage: stage.to_owned(),
        },
    );
}

fn emit_failure(app: &AppHandle, error: AuthErrorPayload) {
    let _ = app.emit("auth://failed", error);
}
