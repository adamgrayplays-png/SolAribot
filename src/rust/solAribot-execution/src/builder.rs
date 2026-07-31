//! Transaction builder for atomic multi-hop arbitrage execution.
//!
//! Constructs Versioned Transactions with Address Lookup Tables (ALTs)
//! to minimize transaction size and enable more instructions per tx.

use solana_sdk::{
    address_lookup_table::AddressLookupTableAccount,
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction},
    message::{
        v0::{self, Message},
        VersionedMessage,
    },
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::VersionedTransaction,
};

use solAribot_core::{Result, SolAribotError, TradeHop, TradeRoute};

/// Result of building a transaction.
pub struct BuiltTransaction {
    pub transaction: VersionedTransaction,
    pub expected_output: u64,
    pub compute_units_allocated: u32,
    pub priority_fee_micro_lamports: u64,
}

/// Transaction builder for multi-hop arbitrage.
pub struct TransactionBuilder {
    /// The trader's keypair for signing.
    pub signer: Keypair,
    /// Known Address Lookup Tables to include in the transaction.
    pub lookup_tables: Vec<AddressLookupTableAccount>,
}

impl TransactionBuilder {
    /// Create a new builder.
    pub fn new(signer: Keypair) -> Self {
        Self {
            signer,
            lookup_tables: Vec::new(),
        }
    }

    /// Add an Address Lookup Table.
    pub fn with_lookup_table(mut self, alt: AddressLookupTableAccount) -> Self {
        self.lookup_tables.push(alt);
        self
    }

    /// Build a Versioned Transaction for a single-hop swap.
    pub fn build_single_hop(
        &self,
        ix: Instruction,
        compute_units: u32,
        priority_fee_micro_lamports: u64,
    ) -> Result<BuiltTransaction> {
        let blockhash = solana_sdk::hash::Hash::new_unique(); // placeholder — filled by sender

        let instructions = vec![
            ComputeBudgetInstruction::set_compute_unit_limit(compute_units),
            ComputeBudgetInstruction::set_compute_unit_price(priority_fee_micro_lamports),
            ix,
        ];

        let message = Message::try_compile(
            &self.signer.pubkey(),
            &instructions,
            &self.lookup_tables,
            blockhash,
        )
        .map_err(|e| SolAribotError::TransactionError(format!("Message compile: {}", e)))?;

        let versioned = VersionedMessage::V0(message);

        Ok(BuiltTransaction {
            transaction: VersionedTransaction {
                signatures: vec![],
                message: versioned,
            },
            expected_output: 0,
            compute_units_allocated: compute_units,
            priority_fee_micro_lamports,
        })
    }

    /// Build a Versioned Transaction for a multi-hop arbitrage route.
    pub fn build_multi_hop(
        &self,
        route: &TradeRoute,
        compute_units_per_hop: u32,
        priority_fee_micro_lamports: u64,
    ) -> Result<BuiltTransaction> {
        let total_cu = compute_units_per_hop * (route.hops.len() as u32);
        let total_cu = total_cu.max(200_000);

        let mut instructions = Vec::new();

        instructions.push(
            ComputeBudgetInstruction::set_compute_unit_limit(total_cu),
        );
        instructions.push(
            ComputeBudgetInstruction::set_compute_unit_price(priority_fee_micro_lamports),
        );

        for hop in &route.hops {
            let swap_ix = self.build_swap_instruction(hop)?;
            instructions.push(swap_ix);
        }

        let blockhash = solana_sdk::hash::Hash::new_unique();

        let message = Message::try_compile(
            &self.signer.pubkey(),
            &instructions,
            &self.lookup_tables,
            blockhash,
        )
        .map_err(|e| SolAribotError::TransactionError(format!("Message compile: {}", e)))?;

        let versioned = VersionedMessage::V0(message);

        Ok(BuiltTransaction {
            transaction: VersionedTransaction {
                signatures: vec![],
                message: versioned,
            },
            expected_output: route.expected_output,
            compute_units_allocated: total_cu,
            priority_fee_micro_lamports,
        })
    }

    /// Build a Jupiter swap instruction for a given hop.
    fn build_swap_instruction(&self, hop: &TradeHop) -> Result<Instruction> {
        let accounts = vec![
            AccountMeta::new(self.signer.pubkey(), true),
            AccountMeta::new(hop.pool_address, false),
        ];

        let mut data = Vec::new();
        data.extend_from_slice(&[0x00; 8]); // Jupiter route discriminator
        data.extend_from_slice(&hop.amount_in.to_le_bytes());
        data.extend_from_slice(&hop.min_amount_out.to_le_bytes());

        Ok(Instruction {
            program_id: solAribot_core::program_ids::resolve(
                solAribot_core::program_ids::JUPITER_V6,
            ),
            accounts,
            data,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builder_creation() {
        let keypair = Keypair::new();
        let builder = TransactionBuilder::new(keypair);
        assert!(!builder.signer.pubkey().to_string().is_empty());
        assert!(builder.lookup_tables.is_empty());
    }

    #[test]
    fn test_builder_with_lookup_table() {
        let keypair = Keypair::new();
        let alt = AddressLookupTableAccount {
            key: Pubkey::new_unique(),
            addresses: vec![Pubkey::new_unique()],
        };
        let builder = TransactionBuilder::new(keypair).with_lookup_table(alt);
        assert_eq!(builder.lookup_tables.len(), 1);
    }
}
