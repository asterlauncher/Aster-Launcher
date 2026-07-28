use std::path::PathBuf;

#[cfg(not(windows))]
use keyring::{Entry, Error as KeyringError};

use crate::{
    errors::AuthError,
    models::account::{StoredAccount, StoredAccounts},
};

#[cfg(not(windows))]
const KEYRING_SERVICE: &str = "dev.aster.launcher.authentication";
#[cfg(not(windows))]
const KEYRING_USER: &str = "accounts";

#[derive(Clone)]
pub struct TokenStore {
    encrypted_path: PathBuf,
}

impl TokenStore {
    pub fn new(encrypted_path: PathBuf) -> Self {
        Self { encrypted_path }
    }

    pub async fn load(&self) -> Result<StoredAccounts, AuthError> {
        let encrypted_path = self.encrypted_path.clone();
        tokio::task::spawn_blocking(move || load_accounts(encrypted_path))
            .await
            .map_err(|_| AuthError::SecureStorage)?
    }

    pub async fn save_active(&self, account: StoredAccount) -> Result<(), AuthError> {
        let mut accounts = self.load().await?;
        accounts.set_active(account);
        let encrypted_path = self.encrypted_path.clone();
        tokio::task::spawn_blocking(move || save_accounts(encrypted_path, &accounts))
            .await
            .map_err(|_| AuthError::SecureStorage)?
    }

    pub async fn clear(&self) -> Result<(), AuthError> {
        let encrypted_path = self.encrypted_path.clone();
        tokio::task::spawn_blocking(move || clear_accounts(encrypted_path))
            .await
            .map_err(|_| AuthError::SecureStorage)?
    }
}

#[cfg(windows)]
fn load_accounts(encrypted_path: PathBuf) -> Result<StoredAccounts, AuthError> {
    let payload = match std::fs::read(encrypted_path) {
        Ok(payload) => payload,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StoredAccounts::default())
        }
        Err(_) => return Err(AuthError::SecureStorage),
    };
    let decrypted = windows_dpapi::decrypt(&payload)?;
    serde_json::from_slice(&decrypted).map_err(|_| AuthError::SecureStorage)
}

#[cfg(windows)]
fn save_accounts(encrypted_path: PathBuf, accounts: &StoredAccounts) -> Result<(), AuthError> {
    let payload = serde_json::to_vec(accounts).map_err(|_| AuthError::SecureStorage)?;
    let encrypted = windows_dpapi::encrypt(&payload)?;
    let parent = encrypted_path.parent().ok_or(AuthError::SecureStorage)?;
    std::fs::create_dir_all(parent).map_err(|_| AuthError::SecureStorage)?;

    let temporary = encrypted_path.with_extension("bin.new");
    std::fs::write(&temporary, encrypted).map_err(|_| AuthError::SecureStorage)?;
    if encrypted_path.exists() {
        std::fs::remove_file(&encrypted_path).map_err(|_| AuthError::SecureStorage)?;
    }
    std::fs::rename(temporary, encrypted_path).map_err(|_| AuthError::SecureStorage)
}

#[cfg(windows)]
fn clear_accounts(encrypted_path: PathBuf) -> Result<(), AuthError> {
    match std::fs::remove_file(encrypted_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(AuthError::SecureStorage),
    }
}

#[cfg(not(windows))]
fn keyring_entry() -> Result<Entry, AuthError> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| AuthError::SecureStorage)
}

#[cfg(not(windows))]
fn load_accounts(_encrypted_path: PathBuf) -> Result<StoredAccounts, AuthError> {
    match keyring_entry()?.get_password() {
        Ok(payload) => serde_json::from_str(&payload).map_err(|_| AuthError::SecureStorage),
        Err(KeyringError::NoEntry) => Ok(StoredAccounts::default()),
        Err(_) => Err(AuthError::SecureStorage),
    }
}

#[cfg(not(windows))]
fn save_accounts(_encrypted_path: PathBuf, accounts: &StoredAccounts) -> Result<(), AuthError> {
    let payload = serde_json::to_string(accounts).map_err(|_| AuthError::SecureStorage)?;
    keyring_entry()?
        .set_password(&payload)
        .map_err(|_| AuthError::SecureStorage)
}

#[cfg(not(windows))]
fn clear_accounts(_encrypted_path: PathBuf) -> Result<(), AuthError> {
    match keyring_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err(AuthError::SecureStorage),
    }
}

#[cfg(windows)]
mod windows_dpapi {
    use std::{ptr, slice};

    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    use crate::errors::AuthError;

    const ASTER_ENTROPY: &[u8] = b"dev.aster.launcher.account-session.v1";

    struct LocalBlob(CRYPT_INTEGER_BLOB);

    impl LocalBlob {
        fn into_bytes(self) -> Result<Vec<u8>, AuthError> {
            if self.0.pbData.is_null() && self.0.cbData != 0 {
                return Err(AuthError::SecureStorage);
            }
            let bytes = unsafe {
                slice::from_raw_parts(self.0.pbData.cast_const(), self.0.cbData as usize).to_vec()
            };
            Ok(bytes)
        }
    }

    impl Drop for LocalBlob {
        fn drop(&mut self) {
            if !self.0.pbData.is_null() {
                unsafe {
                    LocalFree(self.0.pbData.cast());
                }
                self.0.pbData = ptr::null_mut();
                self.0.cbData = 0;
            }
        }
    }

    fn input_blob(payload: &[u8]) -> Result<CRYPT_INTEGER_BLOB, AuthError> {
        Ok(CRYPT_INTEGER_BLOB {
            cbData: payload
                .len()
                .try_into()
                .map_err(|_| AuthError::SecureStorage)?,
            pbData: payload.as_ptr().cast_mut(),
        })
    }

    pub fn encrypt(payload: &[u8]) -> Result<Vec<u8>, AuthError> {
        let input = input_blob(payload)?;
        let entropy = input_blob(ASTER_ENTROPY)?;
        let mut output = LocalBlob(CRYPT_INTEGER_BLOB::default());
        let succeeded = unsafe {
            CryptProtectData(
                &input,
                ptr::null(),
                &entropy,
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        };
        if succeeded == 0 {
            return Err(AuthError::SecureStorage);
        }
        output.into_bytes()
    }

    pub fn decrypt(payload: &[u8]) -> Result<Vec<u8>, AuthError> {
        let input = input_blob(payload)?;
        let entropy = input_blob(ASTER_ENTROPY)?;
        let mut output = LocalBlob(CRYPT_INTEGER_BLOB::default());
        let succeeded = unsafe {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                &entropy,
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        };
        if succeeded == 0 {
            return Err(AuthError::SecureStorage);
        }
        output.into_bytes()
    }

    #[cfg(test)]
    mod tests {
        use super::{decrypt, encrypt};

        #[test]
        fn dpapi_round_trip_handles_large_account_payloads() {
            let payload = b"account-token-material".repeat(500);
            let encrypted = encrypt(&payload).expect("encrypt with Windows DPAPI");
            assert_ne!(encrypted, payload);
            assert!(!encrypted
                .windows("account-token-material".len())
                .any(|window| window == b"account-token-material"));
            assert_eq!(
                decrypt(&encrypted).expect("decrypt with Windows DPAPI"),
                payload
            );
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{clear_accounts, load_accounts, save_accounts};
    use crate::models::account::{PublicAccount, SessionState, StoredAccount, StoredAccounts};

    #[test]
    fn encrypted_account_file_round_trips_without_plaintext_tokens() {
        let directory =
            std::env::temp_dir().join(format!("aster-account-test-{}", uuid::Uuid::new_v4()));
        let path = directory.join(".account-session.bin");
        let mut accounts = StoredAccounts::default();
        accounts.set_active(StoredAccount {
            account: PublicAccount {
                id: "test-player".to_owned(),
                username: "AsterTester".to_owned(),
                skin_path: None,
                owns_java: true,
                session_state: SessionState::Active,
            },
            microsoft_refresh_token: "private-refresh-token".repeat(200),
            minecraft_access_token: "private-minecraft-token".repeat(200),
            minecraft_expires_at: 10_000,
            updated_at: 9_000,
        });

        save_accounts(path.clone(), &accounts).expect("save encrypted account");
        let encrypted = std::fs::read(&path).expect("read encrypted account");
        assert!(!encrypted
            .windows("private-refresh-token".len())
            .any(|window| window == b"private-refresh-token"));

        let loaded = load_accounts(path.clone()).expect("load encrypted account");
        let active = loaded.active().expect("active account");
        assert_eq!(active.account.username, "AsterTester");
        assert_eq!(
            active.microsoft_refresh_token,
            "private-refresh-token".repeat(200)
        );

        clear_accounts(path).expect("clear encrypted account");
        let _ = std::fs::remove_dir_all(directory);
    }
}
