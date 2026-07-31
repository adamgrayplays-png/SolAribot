//! Transaction sender with automatic retry, blockhash refresh, and simulation.
//!
//! Handles sending Versioned Transactions to the Solana network with:
//! - Transaction simulation before submission
//! - Automatic blockhash refresh on expiry
//! - Exponential backoff retry with configurable max attempts
//! - Timeout enforcement per attempt
//! - Confirmation polling

use std::time::Duration;

use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::RpcSimulateTransactionConfig;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    message::VersionedMessage,
    signature::{Keypair, Signer},
    transaction::VersionedTransaction,
};
use tokio::time;

use solAribot_core::{Result, SolAribotError};

use crate::builder::BuiltTransaction;

/// Configuration for the transaction sender.
#[derive(Debug, Clone)]
pub struct SenderConfig {
    pub max_retries: u32,
    pub retry_base_delay_ms: u64,
    pub retry_max_delay_ms: u64,
    pub send_timeout_ms: u64,
    pub simulate_before_send: bool,
    pub commitment: CommitmentConfig,
    pub max_blockhash_age_slots: u64,
}

impl Default for SenderConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            retry_base_delay_ms: 200,
            retry_max_delay_ms: 2_000,
            send_timeout_ms: 15_000,
            simulate_before_send: true,
            commitment: CommitmentConfig::confirmed(),
            max_blockhash_age_slots: 150,
        }
    }
}

/// Result of sending a transaction.
#[derive(Debug, Clone)]
pub struct SendResult {
    pub signature: String,
    pub slot: u64,
    pub compute_units_consumed: u64,
    pub success: bool,
}

/// Asynchronous transaction sender.
pub struct TransactionSender {
    rpc: RpcClient,
    config: SenderConfig,
    signer: Keypair,
}

impl TransactionSender {
    /// Create a new sender.
    pub fn new(rpc_url: &str, signer: Keypair, config: SenderConfig) -> Self {
        let rpc = RpcClient::new_with_commitment(rpc_url.to_string(), config.commitment);
        Self {
            rpc,
            config,
            signer,
        }
    }

    /// Get a reference to the RPC client.
    pub fn rpc(&self) -> &RpcClient {
        &self.rpc
    }

    /// Get the signer's public key.
    pub fn pubkey(&self) -> solana_sdk::pubkey::Pubkey {
        self.signer.pubkey()
    }

    /// Simulate a transaction before sending.
    pub async fn simulate(&self, tx: &VersionedTransaction) -> Result<()> {
        let config = RpcSimulateTransactionConfig {
            sig_verify: false,
            replace_recent_blockhash: true,
            commitment: Some(self.config.commitment),
            ..Default::default()
        };

        let result = self
            .rpc
            .simulate_transaction_with_config(tx, config)
            .await
            .map_err(|e| SolAribotError::RpcError(format!("Simulate RPC: {}", e)))?;

        if let Some(err) = result.value.err {
            return Err(SolAribotError::SimulationFailed(format!(
                "Simulation error: {:?} — logs: {:?}",
                err, result.value.logs
            )));
        }

        if let Some(units) = result.value.units_consumed {
            log::debug!("Simulation used {} compute units", units);
        }

        Ok(())
    }

    /// Send a transaction with retry logic.
    pub async fn send_with_retry(
        &self,
        built: BuiltTransaction,
    ) -> Result<SendResult> {
        let mut attempt = 0;
        let mut tx = built.transaction;

        loop {
            attempt += 1;

            // Refresh blockhash
            let blockhash = match self.get_fresh_blockhash().await {
                Ok(bh) => bh,
                Err(e) => {
                    if attempt >= self.config.max_retries {
                        return Err(e);
                    }
                    self.sleep_backoff(attempt).await;
                    continue;
                }
            };

            // Update the transaction's blockhash
            if let Err(e) = update_blockhash(&mut tx, blockhash) {
                if attempt >= self.config.max_retries {
                    return Err(e);
                }
                self.sleep_backoff(attempt).await;
                continue;
            }

            // Sign the transaction
            let signed_tx = self.sign_transaction(&tx);

            // Simulate if configured and this is the first attempt
            if self.config.simulate_before_send && attempt == 1 {
                if let Err(e) = self.simulate(&signed_tx).await {
                    log::warn!("Simulation failed (attempt {}): {}", attempt, e);
                    if attempt >= self.config.max_retries {
                        return Err(e);
                    }
                    self.sleep_backoff(attempt).await;
                    continue;
                }
            }

            // Send and confirm
            match self.send_and_confirm(&signed_tx).await {
                Ok(result) => {
                    log::info!(
                        "Transaction confirmed: {} (slot {}, {} CU)",
                        result.signature,
                        result.slot,
                        result.compute_units_consumed
                    );
                    return Ok(result);
                }
                Err(e) => {
                    log::warn!("Send failed (attempt {}): {}", attempt, e);
                    if attempt >= self.config.max_retries {
                        return Err(e);
                    }
                    self.sleep_backoff(attempt).await;
                    continue;
                }
            }
        }
    }

    /// Get a fresh blockhash from the RPC.
    async fn get_fresh_blockhash(&self) -> Result<solana_sdk::hash::Hash> {
        self.rpc
            .get_latest_blockhash()
            .await
            .map_err(|e| SolAribotError::RpcError(format!("getLatestBlockhash: {}", e)))
    }

    /// Sign a VersionedTransaction with the configured keypair.
    fn sign_transaction(&self, tx: &VersionedTransaction) -> VersionedTransaction {
        // Clone and sign
        let message_data = tx.message.serialize();
        let sig = self.signer.sign_message(&message_data);
        let sig = solana_sdk::signature::Signature::from(sig);

        VersionedTransaction {
            signatures: vec![sig],
            message: tx.message.clone(),
        }
    }

    /// Send a signed transaction and wait for confirmation.
    async fn send_and_confirm(
        &self,
        signed_tx: &VersionedTransaction,
    ) -> Result<SendResult> {
        let signature = self
            .rpc
            .send_transaction(signed_tx)
            .await
            .map_err(|e| SolAribotError::TransactionError(format!("sendTransaction: {}", e)))?;

        log::debug!("Sent transaction: {}", signature);

        let timeout = Duration::from_millis(self.config.send_timeout_ms);
        let start = time::Instant::now();

        loop {
            if start.elapsed() > timeout {
                return Err(SolAribotError::Timeout(format!(
                    "Transaction {} not confirmed within {}ms",
                    signature,
                    self.config.send_timeout_ms
                )));
            }

            match self
                .rpc
                .get_signature_status_with_commitment(&signature, self.config.commitment)
                .await
            {
                Ok(Some(Ok(()))) => {
                    // Transaction succeeded
                    log::info!("Transaction {} confirmed successfully", signature);
                    return Ok(SendResult {
                        signature: signature.to_string(),
                        slot: 0,
                        compute_units_consumed: 0,
                        success: true,
                    });
                }
                Ok(Some(Err(err))) => {
                    // Transaction failed
                    return Err(SolAribotError::TransactionError(format!(
                        "Transaction {} failed: {:?}",
                        signature, err
                    )));
                }
                Ok(None) => {
                    // Not yet confirmed; keep polling
                }
                Err(e) => {
                    log::warn!("Error checking signature status: {}", e);
                }
            }

            time::sleep(Duration::from_millis(200)).await;
        }
    }

    /// Exponential backoff sleep.
    async fn sleep_backoff(&self, attempt: u32) {
        let delay = self.config.retry_base_delay_ms * 2u64.pow(attempt - 1);
        let delay = delay.min(self.config.retry_max_delay_ms);
        log::debug!("Retrying in {}ms (attempt {})", delay, attempt);
        time::sleep(Duration::from_millis(delay)).await;
    }
}

/// Update the blockhash in a VersionedTransaction's message.
fn update_blockhash(
    tx: &mut VersionedTransaction,
    blockhash: solana_sdk::hash::Hash,
) -> Result<()> {
    match &mut tx.message {
        VersionedMessage::V0(ref mut v0) => {
            v0.recent_blockhash = blockhash;
            Ok(())
        }
        VersionedMessage::Legacy(ref mut legacy) => {
            legacy.recent_blockhash = blockhash;
            Ok(())
        }
        _ => Err(SolAribotError::TransactionError(
            "Unsupported message version".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sender_config_defaults() {
        let config = SenderConfig::default();
        assert_eq!(config.max_retries, 3);
        assert!(config.simulate_before_send);
    }

    #[test]
    fn test_sender_creation() {
        let keypair = Keypair::new();
        let sender = TransactionSender::new(
            "https://api.mainnet-beta.solana.com",
            keypair,
            SenderConfig::default(),
        );
        assert!(!sender.pubkey().to_string().is_empty());
    }
}
