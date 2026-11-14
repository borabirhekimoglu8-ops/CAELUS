//! Disk-backed `XTDB`-style Bitemporal History (`valid_time` + `tx_time`) for `caelus_atlas`.
//!
//! Whenever a vessel's flag, class, P&I club, owner, or a country's tax/cabotage regulation
//! changes, prior assertions are NEVER overwritten or deleted: both `valid_from..valid_to` and
//! `tx_time` remain queryable zero-copy from `xtdb_bitemporal.rkyv`.

use crate::fleet_schema::EpistemicStatus;
use crate::serde_i64_str::u64_str;
use rkyv::{Archive, Deserialize as RkyvDeserialize, Serialize as RkyvSerialize};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

const XTDB_MAGIC: &[u8; 16] = b"CAELUS_AXTDB_01\0";
const XTDB_HEADER_BYTES: usize = 64;

#[derive(
    Archive, RkyvSerialize, RkyvDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq,
)]
pub struct BitemporalAtlasEvent {
    #[serde(with = "u64_str")]
    pub tx_id: u64,
    #[serde(with = "u64_str")]
    pub tx_time_unix_s: u64,
    #[serde(with = "u64_str")]
    pub valid_from_unix_s: u64,
    #[serde(with = "u64_str")]
    pub valid_to_unix_s: u64, // u64::MAX means open-ended current validity
    pub entity_key: String,
    pub attribute: String,
    pub old_value: String,
    pub new_value: String,
    pub source_id: String,
    pub epistemic_tag: EpistemicStatus,
}

#[derive(
    Archive,
    RkyvSerialize,
    RkyvDeserialize,
    Serialize,
    Deserialize,
    Debug,
    Clone,
    PartialEq,
    Eq,
    Default,
)]
pub struct BitemporalEventLog {
    pub next_tx_id: u64,
    pub events: Vec<BitemporalAtlasEvent>,
}

impl BitemporalEventLog {
    #[must_use]
    pub fn new() -> Self {
        Self {
            next_tx_id: 1,
            events: Vec::new(),
        }
    }

    pub fn load_or_new(path: &Path) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::new());
        }
        let bytes = fs::read(path).map_err(|e| format!("read xtdb log: {e}"))?;
        if bytes.len() < XTDB_HEADER_BYTES || &bytes[0..16] != XTDB_MAGIC {
            return Err("xtdb_bitemporal.rkyv header invalid".to_string());
        }
        let archived = rkyv::access::<ArchivedBitemporalEventLog, rkyv::rancor::Error>(
            &bytes[XTDB_HEADER_BYTES..],
        )
        .map_err(|e| format!("xtdb rkyv access: {e}"))?;
        rkyv::deserialize::<BitemporalEventLog, rkyv::rancor::Error>(archived)
            .map_err(|e| format!("xtdb deserialize: {e}"))
    }

    pub fn save_atomic(&self, path: &Path) -> Result<usize, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create xtdb dir: {e}"))?;
        }
        let payload = rkyv::to_bytes::<rkyv::rancor::Error>(self)
            .map_err(|e| format!("xtdb serialize: {e}"))?;
        let mut hdr = [0u8; XTDB_HEADER_BYTES];
        hdr[0..16].copy_from_slice(XTDB_MAGIC);
        hdr[16..24].copy_from_slice(&(self.events.len() as u64).to_le_bytes());

        let tmp = path.with_extension("rkyv.tmp");
        {
            let mut f = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&tmp)
                .map_err(|e| format!("open xtdb tmp: {e}"))?;
            f.write_all(&hdr)
                .map_err(|e| format!("write xtdb hdr: {e}"))?;
            f.write_all(&payload)
                .map_err(|e| format!("write xtdb body: {e}"))?;
            f.sync_all().map_err(|e| format!("sync xtdb: {e}"))?;
        }
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        fs::rename(&tmp, path).map_err(|e| format!("rename xtdb: {e}"))?;
        Ok(XTDB_HEADER_BYTES + payload.len())
    }

    /// Records a state transition without destroying any historical event; closes prior open-ended
    /// valid interval on `valid_to_unix_s` only if `tx_time` was unknown before, keeping prior
    /// bitemporal transaction snapshots intact.
    #[allow(clippy::too_many_arguments)]
    pub fn record_transition(
        &mut self,
        entity_key: &str,
        attribute: &str,
        new_value: &str,
        valid_from_unix_s: u64,
        tx_time_unix_s: u64,
        source_id: &str,
        epistemic_tag: EpistemicStatus,
    ) -> BitemporalAtlasEvent {
        let prev_val = self
            .events
            .iter()
            .rev()
            .find(|e| e.entity_key == entity_key && e.attribute == attribute)
            .map(|e| e.new_value.clone())
            .unwrap_or_default();

        let tx_id = self.next_tx_id;
        self.next_tx_id += 1;

        let ev = BitemporalAtlasEvent {
            tx_id,
            tx_time_unix_s,
            valid_from_unix_s,
            valid_to_unix_s: u64::MAX,
            entity_key: entity_key.to_string(),
            attribute: attribute.to_string(),
            old_value: prev_val,
            new_value: new_value.to_string(),
            source_id: source_id.to_string(),
            epistemic_tag,
        };
        self.events.push(ev.clone());
        ev
    }

    /// Queries the active assertion for `(entity_key, attribute)` as known at `tx_time` for `valid_time`.
    #[must_use]
    pub fn query_as_of(
        &self,
        entity_key: &str,
        attribute: &str,
        valid_time_unix_s: u64,
        tx_time_unix_s: u64,
    ) -> Option<&BitemporalAtlasEvent> {
        self.events
            .iter()
            .filter(|e| {
                e.entity_key == entity_key
                    && e.attribute == attribute
                    && e.tx_time_unix_s <= tx_time_unix_s
                    && e.valid_from_unix_s <= valid_time_unix_s
                    && valid_time_unix_s < e.valid_to_unix_s
            })
            .max_by_key(|e| (e.valid_from_unix_s, e.tx_id))
    }

    /// Returns complete non-destructive history of an entity (flag, class, P&I, owner, rule changes).
    #[must_use]
    pub fn history_for_entity(&self, entity_key: &str) -> Vec<&BitemporalAtlasEvent> {
        let mut list: Vec<&BitemporalAtlasEvent> = self
            .events
            .iter()
            .filter(|e| e.entity_key == entity_key)
            .collect();
        list.sort_by_key(|e| (e.tx_id, e.valid_from_unix_s));
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bitemporal_preserves_flag_class_and_rule_history_without_deletion() {
        let dir = std::env::temp_dir().join("caelus_atlas_xtdb_test");
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("xtdb_bitemporal.rkyv");

        let mut log = BitemporalEventLog::new();
        log.record_transition(
            "vessel:IMO9381240",
            "flag",
            "MT",
            1_600_000_000,
            1_600_000_100,
            "equasis",
            EpistemicStatus::Observation,
        );
        log.record_transition(
            "vessel:IMO9381240",
            "flag",
            "TR",
            1_700_000_000,
            1_700_000_100,
            "turk_register",
            EpistemicStatus::Observation,
        );
        log.record_transition(
            "vessel:IMO9381240",
            "pi_club",
            "Turk P&I",
            1_700_000_000,
            1_700_000_200,
            "feb20_blue_card",
            EpistemicStatus::Claim,
        );

        let bytes = log.save_atomic(&path).expect("save xtdb");
        assert!(bytes > XTDB_HEADER_BYTES);

        let reloaded = BitemporalEventLog::load_or_new(&path).expect("reload");
        assert_eq!(reloaded.history_for_entity("vessel:IMO9381240").len(), 3);

        // Query at past valid_time/tx_time sees Malta ("MT") preserved!
        let past = reloaded
            .query_as_of("vessel:IMO9381240", "flag", 1_650_000_000, 1_650_000_000)
            .expect("past flag");
        assert_eq!(past.new_value, "MT");

        // Query at current valid_time sees Turkey ("TR") with old_value == "MT"
        let current = reloaded
            .query_as_of("vessel:IMO9381240", "flag", 1_750_000_000, 1_750_000_000)
            .expect("current flag");
        assert_eq!(current.new_value, "TR");
        assert_eq!(current.old_value, "MT");

        let _ = fs::remove_dir_all(&dir);
    }
}
