pub mod callback;
pub mod microsoft;
pub mod minecraft;
pub mod token_store;
pub mod xbox;

use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::Client;
use tokio::{sync::Mutex, task::JoinHandle};

use crate::{
    errors::AuthError,
    models::{
        account::{PublicAccount, SessionState, StoredAccount},
        auth::CallbackPayload,
    },
};

use self::{callback::CallbackSession, token_store::TokenStore};

const REFRESH_LEEWAY_SECONDS: i64 = 120;

pub struct AuthenticationOutcome {
    pub account: PublicAccount,
    pub skin_warning: bool,
}

pub struct PendingLogin {
    pub request_id: String,
    pub state: String,
    pub verifier: String,
    pub redirect_uri: String,
    pub expires_at: i64,
    pub callback_receiver: tokio::sync::oneshot::Receiver<Result<CallbackPayload, AuthError>>,
    pub callback_task: JoinHandle<()>,
}

impl PendingLogin {
    pub fn from_callback(
        request_id: String,
        state: String,
        verifier: String,
        expires_at: i64,
        callback: CallbackSession,
    ) -> Self {
        Self {
            request_id,
            state,
            verifier,
            redirect_uri: callback.redirect_uri,
            expires_at,
            callback_receiver: callback.receiver,
            callback_task: callback.task,
        }
    }
}

pub struct AuthState {
    pub service: Arc<AuthService>,
    pub pending: Mutex<Option<PendingLogin>>,
}

impl AuthState {
    pub fn new(service: AuthService) -> Self {
        Self {
            service: Arc::new(service),
            pending: Mutex::new(None),
        }
    }
}

pub struct AuthService {
    client_id: Option<String>,
    http: Client,
    store: TokenStore,
    skin_directory: PathBuf,
}

impl AuthService {
    pub fn new(skin_directory: PathBuf) -> Result<Self, AuthError> {
        let account_storage_path = skin_directory
            .parent()
            .ok_or(AuthError::Internal)?
            .join(".account-session.bin");
        let client_id = std::env::var("VITE_MICROSOFT_CLIENT_ID")
            .ok()
            .or_else(|| option_env!("VITE_MICROSOFT_CLIENT_ID").map(ToOwned::to_owned))
            .filter(|value| !value.trim().is_empty());
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25))
            .user_agent("AsterLauncher/0.1 authentication")
            .build()
            .map_err(|_| AuthError::Internal)?;

        Ok(Self {
            client_id,
            http,
            store: TokenStore::new(account_storage_path),
            skin_directory,
        })
    }

    pub fn client_id(&self) -> Result<&str, AuthError> {
        self.client_id.as_deref().ok_or(AuthError::Configuration)
    }

    pub async fn authenticate_code<F>(
        &self,
        callback: CallbackPayload,
        expected_state: &str,
        verifier: &str,
        redirect_uri: &str,
        mut progress: F,
    ) -> Result<AuthenticationOutcome, AuthError>
    where
        F: FnMut(&'static str),
    {
        microsoft::validate_state(expected_state, &callback.state)?;
        let microsoft = microsoft::exchange_authorization_code(
            &self.http,
            self.client_id()?,
            &callback.code,
            verifier,
            redirect_uri,
        )
        .await?;

        progress("xbox-authenticating");
        let outcome = self
            .authenticate_downstream(&microsoft.access_token, microsoft.refresh_token, progress)
            .await?;
        Ok(outcome)
    }

    pub async fn get_or_refresh_active(&self) -> Result<Option<PublicAccount>, AuthError> {
        let accounts = self.store.load().await?;
        let Some(active) = accounts.active().cloned() else {
            return Ok(None);
        };

        if active.minecraft_token_expired(now_unix(), REFRESH_LEEWAY_SECONDS) {
            return self.refresh_stored(active).await.map(Some);
        }
        match self.sync_stored_profile(active.clone()).await {
            Ok(account) => Ok(Some(account)),
            Err(_) => Ok(Some(active.account)),
        }
    }

    pub async fn refresh_active(&self) -> Result<PublicAccount, AuthError> {
        let accounts = self.store.load().await?;
        let active = accounts
            .active()
            .cloned()
            .ok_or(AuthError::SessionExpired)?;
        self.refresh_stored(active).await
    }

    pub async fn active_without_refresh(&self) -> Result<Option<StoredAccount>, AuthError> {
        Ok(self.store.load().await?.active().cloned())
    }

    pub async fn active_for_launch(&self) -> Result<StoredAccount, AuthError> {
        self.get_or_refresh_active()
            .await?
            .ok_or(AuthError::SessionExpired)?;
        self.store
            .load()
            .await?
            .active()
            .cloned()
            .ok_or(AuthError::SessionExpired)
    }

    pub async fn sign_out(&self) -> Result<(), AuthError> {
        let skin_path = self.store.load().await.ok().and_then(|accounts| {
            accounts
                .active()
                .and_then(|active| active.account.skin_path.clone())
        });
        self.store.clear().await?;
        if let Some(path) = skin_path {
            let _ = tokio::fs::remove_file(path).await;
        }
        Ok(())
    }

    async fn refresh_stored(&self, active: StoredAccount) -> Result<PublicAccount, AuthError> {
        let microsoft = microsoft::refresh_access_token(
            &self.http,
            self.client_id()?,
            &active.microsoft_refresh_token,
        )
        .await?;
        let outcome = self
            .authenticate_downstream(&microsoft.access_token, microsoft.refresh_token, |_| {})
            .await?;
        Ok(outcome.account)
    }

    async fn sync_stored_profile(&self, active: StoredAccount) -> Result<PublicAccount, AuthError> {
        let profile = minecraft::fetch_profile(&self.http, &active.minecraft_access_token).await?;
        if profile.id != active.account.id {
            return Err(AuthError::MinecraftProfileUnavailable);
        }

        let previous_skin_path = active.account.skin_path.clone();
        let skin_path = if let Some(url) = profile.active_skin_url.as_deref() {
            match minecraft::cache_skin(&self.http, url, &profile.id, &self.skin_directory).await {
                Ok(path) => Some(path.to_string_lossy().into_owned()),
                Err(_) => previous_skin_path.clone(),
            }
        } else {
            None
        };

        let account = PublicAccount {
            id: profile.id,
            username: profile.name,
            skin_path,
            owns_java: true,
            session_state: SessionState::Active,
        };
        self.store
            .save_active(StoredAccount {
                account: account.clone(),
                microsoft_refresh_token: active.microsoft_refresh_token,
                minecraft_access_token: active.minecraft_access_token,
                minecraft_expires_at: active.minecraft_expires_at,
                updated_at: now_unix(),
            })
            .await?;

        if previous_skin_path.as_deref() != account.skin_path.as_deref() {
            if let Some(path) = previous_skin_path {
                let _ = tokio::fs::remove_file(path).await;
            }
        }
        Ok(account)
    }

    async fn authenticate_downstream<F>(
        &self,
        microsoft_access_token: &str,
        microsoft_refresh_token: String,
        mut progress: F,
    ) -> Result<AuthenticationOutcome, AuthError>
    where
        F: FnMut(&'static str),
    {
        let xbox = xbox::authenticate_user(&self.http, microsoft_access_token).await?;
        let xsts = xbox::authorize_xsts(&self.http, &xbox.token).await?;

        progress("minecraft-authenticating");
        let minecraft =
            minecraft::authenticate(&self.http, &xsts.user_hash, &xsts.token, now_unix()).await?;
        minecraft::verify_java_ownership(&self.http, &minecraft.access_token).await?;

        progress("profile-loading");
        let profile = minecraft::fetch_profile(&self.http, &minecraft.access_token).await?;
        let mut skin_warning = false;
        let skin_path = if let Some(url) = profile.active_skin_url.as_deref() {
            match minecraft::cache_skin(&self.http, url, &profile.id, &self.skin_directory).await {
                Ok(path) => Some(path.to_string_lossy().into_owned()),
                Err(_) => {
                    skin_warning = true;
                    None
                }
            }
        } else {
            None
        };

        let account = PublicAccount {
            id: profile.id,
            username: profile.name,
            skin_path,
            owns_java: true,
            session_state: SessionState::Active,
        };
        self.store
            .save_active(StoredAccount {
                account: account.clone(),
                microsoft_refresh_token,
                minecraft_access_token: minecraft.access_token,
                minecraft_expires_at: minecraft.expires_at,
                updated_at: now_unix(),
            })
            .await?;

        Ok(AuthenticationOutcome {
            account,
            skin_warning,
        })
    }
}

pub fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .try_into()
        .unwrap_or(i64::MAX)
}
