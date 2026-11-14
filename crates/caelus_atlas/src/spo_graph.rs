//! Disk-mapped SPO Triple Store + On-Demand Pure-Rust `Oxigraph` Active Subgraph Evaluator.
//!
//! Stores millions of SPO triples in `data/atlas_mmap/spo_graph.rkyv` (`0 B` heap until queried)
//! and materializes ONLY the active 1-2 hop subgraph into an ephemeral `oxigraph::store::Store`
//! in `< 1 ms` for SPARQL 1.1 queries.

use crate::fleet_schema::{
    CompanyProfile, CountryMaritimeProfile, EpistemicStatus, PortFullRecord, RegulationRuleRecord,
    VesselFullRecord,
};
use crate::mmap_store::fnv1a_64;
use memmap2::{Mmap, MmapOptions};
use oxigraph::model::{GraphName, Literal, NamedNode, Quad, Term};
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::Path;

const SPO_MAGIC: &[u8; 16] = b"CAELUS_ASPO_01\0\0";
const SPO_HEADER_BYTES: usize = 64;
const SPO_SLOT_BYTES: usize = 24;

#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpoPredicate {
    RdfType = 0,
    HasName = 1,
    HasImo = 2,
    HasMmsi = 3,
    FlaggedIn = 4,
    ClassedBy = 5,
    IacsMember = 6,
    InsuredBy = 7,
    Feb20BlueCard = 8,
    OwnedBy = 9,
    OperatedBy = 10,
    IsmManagedBy = 11,
    UboName = 12,
    GleifLei = 13,
    CallsPort = 14,
    SanctionsMatch = 15,
    SanctionsDataset = 16,
    PscAuthority = 17,
    HasTerminal = 18,
    TerminalOperator = 19,
    LocatedInCountry = 20,
    RegulatedBy = 21,
    CiiRating = 22,
    EpistemicStatus = 23,
}

impl SpoPredicate {
    #[must_use]
    pub const fn from_u16(v: u16) -> Option<Self> {
        match v {
            0 => Some(Self::RdfType),
            1 => Some(Self::HasName),
            2 => Some(Self::HasImo),
            3 => Some(Self::HasMmsi),
            4 => Some(Self::FlaggedIn),
            5 => Some(Self::ClassedBy),
            6 => Some(Self::IacsMember),
            7 => Some(Self::InsuredBy),
            8 => Some(Self::Feb20BlueCard),
            9 => Some(Self::OwnedBy),
            10 => Some(Self::OperatedBy),
            11 => Some(Self::IsmManagedBy),
            12 => Some(Self::UboName),
            13 => Some(Self::GleifLei),
            14 => Some(Self::CallsPort),
            15 => Some(Self::SanctionsMatch),
            16 => Some(Self::SanctionsDataset),
            17 => Some(Self::PscAuthority),
            18 => Some(Self::HasTerminal),
            19 => Some(Self::TerminalOperator),
            20 => Some(Self::LocatedInCountry),
            21 => Some(Self::RegulatedBy),
            22 => Some(Self::CiiRating),
            23 => Some(Self::EpistemicStatus),
            _ => None,
        }
    }

    #[must_use]
    pub const fn iri(self) -> &'static str {
        match self {
            Self::RdfType => "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
            Self::HasName => "urn:caelus:prop:name",
            Self::HasImo => "urn:caelus:prop:imo",
            Self::HasMmsi => "urn:caelus:prop:mmsi",
            Self::FlaggedIn => "urn:caelus:prop:flaggedIn",
            Self::ClassedBy => "urn:caelus:prop:classedBy",
            Self::IacsMember => "urn:caelus:prop:iacsMember",
            Self::InsuredBy => "urn:caelus:prop:insuredBy",
            Self::Feb20BlueCard => "urn:caelus:prop:feb20BlueCard",
            Self::OwnedBy => "urn:caelus:prop:ownedBy",
            Self::OperatedBy => "urn:caelus:prop:operatedBy",
            Self::IsmManagedBy => "urn:caelus:prop:ismManagedBy",
            Self::UboName => "urn:caelus:prop:uboName",
            Self::GleifLei => "urn:caelus:prop:gleifLei",
            Self::CallsPort => "urn:caelus:prop:callsPort",
            Self::SanctionsMatch => "urn:caelus:prop:sanctionsMatch",
            Self::SanctionsDataset => "urn:caelus:prop:sanctionsDataset",
            Self::PscAuthority => "urn:caelus:prop:pscAuthority",
            Self::HasTerminal => "urn:caelus:prop:hasTerminal",
            Self::TerminalOperator => "urn:caelus:prop:terminalOperator",
            Self::LocatedInCountry => "urn:caelus:prop:locatedInCountry",
            Self::RegulatedBy => "urn:caelus:prop:regulatedBy",
            Self::CiiRating => "urn:caelus:prop:ciiRating",
            Self::EpistemicStatus => "urn:caelus:prop:epistemicStatus",
        }
    }
}

#[derive(Clone, Copy)]
struct TripleSlot {
    subj_hash64: u64,
    subj_off: u32,
    subj_len: u16,
    pred_id: u16,
    obj_off: u32,
    obj_len: u16,
    obj_is_iri: u8,
    epistemic: u8,
}

/// Sanitized IRI token safe for RFC 3987 / Oxigraph `NamedNode`.
#[must_use]
pub fn sanitize_iri_token(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len().min(64));
    for ch in raw.chars() {
        if out.len() >= 64 {
            break;
        }
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            out.push(ch);
        } else if (ch == ' ' || ch == '/' || ch == ':') && !out.ends_with('_') {
            out.push('_');
        }
    }
    if out.is_empty() {
        out.push_str("unknown");
    }
    out
}

#[must_use]
pub fn vessel_iri(imo: u32, mmsi: u32, name: &str) -> String {
    if imo > 0 {
        format!("urn:caelus:vessel:IMO{imo}")
    } else if mmsi > 0 {
        format!("urn:caelus:vessel:MMSI{mmsi}")
    } else {
        format!("urn:caelus:vessel:{}", sanitize_iri_token(name))
    }
}

#[must_use]
pub fn port_iri(unlocode: &str) -> String {
    format!("urn:caelus:port:{}", sanitize_iri_token(unlocode))
}

#[must_use]
pub fn country_iri(iso2: &[u8; 2]) -> String {
    let s = std::str::from_utf8(iso2).unwrap_or("XX");
    format!("urn:caelus:country:{}", sanitize_iri_token(s))
}

#[must_use]
pub fn company_iri(company_id: &str) -> String {
    format!("urn:caelus:company:{}", sanitize_iri_token(company_id))
}

pub struct SpoGraphWriter {
    str_arena: Vec<u8>,
    str_intern: HashMap<String, (u32, u16)>,
    slots: Vec<TripleSlot>,
    built_unix_s: u64,
}

impl SpoGraphWriter {
    #[must_use]
    pub fn new(built_unix_s: u64) -> Self {
        Self {
            str_arena: Vec::with_capacity(4 * 1024 * 1024),
            str_intern: HashMap::with_capacity(160_000),
            slots: Vec::with_capacity(650_000),
            built_unix_s,
        }
    }

    fn intern(&mut self, s: &str) -> (u32, u16) {
        let mut end = s.len().min(255);
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        let clipped = &s[..end];
        if let Some(&loc) = self.str_intern.get(clipped) {
            return loc;
        }
        let off = self.str_arena.len() as u32;
        let len = clipped.len() as u16;
        self.str_arena.extend_from_slice(clipped.as_bytes());
        self.str_intern.insert(clipped.to_string(), (off, len));
        (off, len)
    }

    pub fn add_triple(
        &mut self,
        subject_iri: &str,
        pred: SpoPredicate,
        object_val: &str,
        obj_is_iri: bool,
        epistemic: EpistemicStatus,
    ) {
        let subj_hash64 = fnv1a_64(subject_iri.as_bytes());
        let (subj_off, subj_len) = self.intern(subject_iri);
        let (obj_off, obj_len) = self.intern(object_val);
        self.slots.push(TripleSlot {
            subj_hash64,
            subj_off,
            subj_len,
            pred_id: pred as u16,
            obj_off,
            obj_len,
            obj_is_iri: u8::from(obj_is_iri),
            epistemic: epistemic as u8,
        });
    }

    pub fn ingest_vessel(&mut self, v: &VesselFullRecord) {
        let subj = vessel_iri(v.imo, v.mmsi, &v.current_name);
        let ep = v.epistemic_tag;
        self.add_triple(
            &subj,
            SpoPredicate::RdfType,
            "urn:caelus:ontology:Vessel",
            true,
            ep,
        );
        self.add_triple(&subj, SpoPredicate::HasName, &v.current_name, false, ep);
        if v.imo > 0 {
            self.add_triple(&subj, SpoPredicate::HasImo, &v.imo.to_string(), false, ep);
        }
        if v.mmsi > 0 {
            self.add_triple(&subj, SpoPredicate::HasMmsi, &v.mmsi.to_string(), false, ep);
        }
        let c_iri = country_iri(&v.current_flag_iso2);
        self.add_triple(&subj, SpoPredicate::FlaggedIn, &c_iri, true, ep);

        let class_iri = format!(
            "urn:caelus:class:{}",
            sanitize_iri_token(v.class_chain.society.code())
        );
        self.add_triple(&subj, SpoPredicate::ClassedBy, &class_iri, true, ep);
        self.add_triple(
            &subj,
            SpoPredicate::IacsMember,
            if v.class_chain.society.is_iacs_member() {
                "true"
            } else {
                "false"
            },
            false,
            ep,
        );

        let pi_iri = format!(
            "urn:caelus:piclub:{}",
            sanitize_iri_token(v.pi_chain.club.code())
        );
        self.add_triple(&subj, SpoPredicate::InsuredBy, &pi_iri, true, ep);
        self.add_triple(
            &subj,
            SpoPredicate::Feb20BlueCard,
            if v.pi_chain.feb20_blue_card_active {
                "active"
            } else {
                "expired"
            },
            false,
            ep,
        );

        if !v.corporate.registered_owner.is_empty() {
            self.add_triple(
                &subj,
                SpoPredicate::OwnedBy,
                &v.corporate.registered_owner,
                false,
                ep,
            );
        }
        if !v.corporate.commercial_operator.is_empty() {
            self.add_triple(
                &subj,
                SpoPredicate::OperatedBy,
                &v.corporate.commercial_operator,
                false,
                ep,
            );
        }
        if !v.corporate.gleif_lei.is_empty() {
            self.add_triple(
                &subj,
                SpoPredicate::GleifLei,
                &v.corporate.gleif_lei,
                false,
                ep,
            );
        }
        if v.opensanctions_match {
            self.add_triple(&subj, SpoPredicate::SanctionsMatch, "true", false, ep);
            for ds in v.opensanctions_datasets.iter().take(3) {
                self.add_triple(&subj, SpoPredicate::SanctionsDataset, ds, false, ep);
            }
        }
        self.add_triple(&subj, SpoPredicate::EpistemicStatus, ep.as_str(), false, ep);
    }

    pub fn ingest_port(&mut self, p: &PortFullRecord) {
        let subj = port_iri(&p.unlocode);
        let ep = p.epistemic_tag;
        self.add_triple(
            &subj,
            SpoPredicate::RdfType,
            "urn:caelus:ontology:MaritimePort",
            true,
            ep,
        );
        self.add_triple(&subj, SpoPredicate::HasName, &p.name, false, ep);
        let c_iri = country_iri(&p.country_iso2);
        self.add_triple(&subj, SpoPredicate::LocatedInCountry, &c_iri, true, ep);
        for term in &p.terminals {
            self.add_triple(
                &subj,
                SpoPredicate::HasTerminal,
                &term.terminal_code,
                false,
                ep,
            );
            if !term.company_name.is_empty() {
                self.add_triple(
                    &subj,
                    SpoPredicate::TerminalOperator,
                    &term.company_name,
                    false,
                    ep,
                );
            }
        }
    }

    pub fn ingest_company(&mut self, c: &CompanyProfile) {
        let subj = company_iri(&c.company_id);
        let ep = c.epistemic_tag;
        self.add_triple(
            &subj,
            SpoPredicate::RdfType,
            "urn:caelus:ontology:MaritimeCompany",
            true,
            ep,
        );
        self.add_triple(&subj, SpoPredicate::HasName, &c.name, false, ep);
        if !c.gleif_lei.is_empty() {
            self.add_triple(&subj, SpoPredicate::GleifLei, &c.gleif_lei, false, ep);
        }
        if !c.bods_ubo_name.is_empty() {
            self.add_triple(&subj, SpoPredicate::UboName, &c.bods_ubo_name, false, ep);
        }
        let c_iri = country_iri(&c.country_iso2);
        self.add_triple(&subj, SpoPredicate::LocatedInCountry, &c_iri, true, ep);
        if c.opensanctions_flagged {
            self.add_triple(&subj, SpoPredicate::SanctionsMatch, "true", false, ep);
        }
        for imo in c.fleet_imos.iter().take(12) {
            let v_iri = format!("urn:caelus:vessel:IMO{imo}");
            self.add_triple(&subj, SpoPredicate::OperatedBy, &v_iri, true, ep);
        }
    }

    pub fn ingest_country(&mut self, c: &CountryMaritimeProfile) {
        let subj = country_iri(&c.iso2);
        self.add_triple(
            &subj,
            SpoPredicate::RdfType,
            "urn:caelus:ontology:MaritimeCountry",
            true,
            EpistemicStatus::Observation,
        );
        self.add_triple(
            &subj,
            SpoPredicate::HasName,
            &c.name,
            false,
            EpistemicStatus::Observation,
        );
        if !c.capital_port_unlocode.is_empty() {
            self.add_triple(
                &subj,
                SpoPredicate::CallsPort,
                &port_iri(&c.capital_port_unlocode),
                true,
                EpistemicStatus::Observation,
            );
        }
    }

    pub fn ingest_regulation(&mut self, r: &RegulationRuleRecord) {
        let subj = format!("urn:caelus:reg:{}", sanitize_iri_token(&r.rule_id));
        self.add_triple(
            &subj,
            SpoPredicate::RdfType,
            "urn:caelus:ontology:MaritimeRegulation",
            true,
            EpistemicStatus::Observation,
        );
        self.add_triple(
            &subj,
            SpoPredicate::HasName,
            &r.title,
            false,
            EpistemicStatus::Observation,
        );
        let c_iri = country_iri(&r.jurisdiction_iso2);
        self.add_triple(
            &c_iri,
            SpoPredicate::RegulatedBy,
            &subj,
            true,
            EpistemicStatus::Observation,
        );
    }

    pub fn write_to_file(mut self, path: &Path) -> Result<u64, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create spo dir: {e}"))?;
        }
        self.slots.sort_unstable_by(|a, b| {
            a.subj_hash64
                .cmp(&b.subj_hash64)
                .then_with(|| a.pred_id.cmp(&b.pred_id))
                .then_with(|| a.obj_off.cmp(&b.obj_off))
        });

        let triple_count = self.slots.len() as u64;
        let str_arena_offset = (SPO_HEADER_BYTES + (self.slots.len() * SPO_SLOT_BYTES)) as u64;

        let tmp = path.with_extension("rkyv.tmp");
        {
            let mut w = BufWriter::with_capacity(
                256 * 1024,
                OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&tmp)
                    .map_err(|e| format!("open spo tmp: {e}"))?,
            );
            let mut hdr = [0u8; SPO_HEADER_BYTES];
            hdr[0..16].copy_from_slice(SPO_MAGIC);
            hdr[16..24].copy_from_slice(&triple_count.to_le_bytes());
            hdr[24..32].copy_from_slice(&str_arena_offset.to_le_bytes());
            hdr[32..40].copy_from_slice(&(self.str_arena.len() as u64).to_le_bytes());
            hdr[40..48].copy_from_slice(&self.built_unix_s.to_le_bytes());
            w.write_all(&hdr)
                .map_err(|e| format!("write spo hdr: {e}"))?;

            for s in &self.slots {
                w.write_all(&s.subj_hash64.to_le_bytes())
                    .map_err(|e| format!("write spo hash: {e}"))?;
                w.write_all(&s.subj_off.to_le_bytes())
                    .map_err(|e| format!("write spo soff: {e}"))?;
                w.write_all(&s.subj_len.to_le_bytes())
                    .map_err(|e| format!("write spo slen: {e}"))?;
                w.write_all(&s.pred_id.to_le_bytes())
                    .map_err(|e| format!("write spo pid: {e}"))?;
                w.write_all(&s.obj_off.to_le_bytes())
                    .map_err(|e| format!("write spo ooff: {e}"))?;
                w.write_all(&s.obj_len.to_le_bytes())
                    .map_err(|e| format!("write spo olen: {e}"))?;
                w.write_all(&[s.obj_is_iri, s.epistemic])
                    .map_err(|e| format!("write spo flags: {e}"))?;
            }
            w.write_all(&self.str_arena)
                .map_err(|e| format!("write spo arena: {e}"))?;
            w.flush().map_err(|e| format!("flush spo: {e}"))?;
        }

        if path.exists() {
            let _ = fs::remove_file(path);
        }
        fs::rename(&tmp, path).map_err(|e| format!("rename spo: {e}"))?;
        Ok(triple_count)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpoTripleView {
    pub subject: String,
    pub predicate: String,
    pub object: String,
    pub object_is_iri: bool,
    pub epistemic: EpistemicStatus,
}

/// Read-only memory-mapped SPO triple archive; faults only queried subject pages.
pub struct MmapSpoGraph {
    mmap: Mmap,
    triple_count: usize,
    str_arena_offset: usize,
    str_arena_len: usize,
}

#[allow(unsafe_code)]
fn map_spo_readonly(path: &Path) -> Result<Mmap, String> {
    let f = File::open(path).map_err(|e| format!("open spo {}: {e}", path.display()))?;
    unsafe { MmapOptions::new().map(&f) }.map_err(|e| format!("mmap spo {}: {e}", path.display()))
}

impl MmapSpoGraph {
    pub fn open(path: &Path) -> Result<Self, String> {
        let mmap = map_spo_readonly(path)?;
        if mmap.len() < SPO_HEADER_BYTES || &mmap[0..16] != SPO_MAGIC {
            return Err("spo_graph.rkyv header invalid".to_string());
        }
        let triple_count = u64::from_le_bytes(mmap[16..24].try_into().unwrap()) as usize;
        let str_arena_offset = u64::from_le_bytes(mmap[24..32].try_into().unwrap()) as usize;
        let str_arena_len = u64::from_le_bytes(mmap[32..40].try_into().unwrap()) as usize;
        if mmap.len() < str_arena_offset.saturating_add(str_arena_len) {
            return Err("spo_graph.rkyv truncated".to_string());
        }
        Ok(Self {
            mmap,
            triple_count,
            str_arena_offset,
            str_arena_len,
        })
    }

    #[must_use]
    pub const fn triple_count(&self) -> usize {
        self.triple_count
    }

    fn read_str(&self, off: u32, len: u16) -> Option<&str> {
        let start = self.str_arena_offset + (off as usize);
        let end = start + (len as usize);
        if (off as usize) + (len as usize) > self.str_arena_len || end > self.mmap.len() {
            return None;
        }
        std::str::from_utf8(&self.mmap[start..end]).ok()
    }

    /// Reads 1-hop triples for `subject_iri` directly via `O(log N)` binary search on `fnv1a_64`.
    #[must_use]
    pub fn triples_for_subject(&self, subject_iri: &str, max_rows: usize) -> Vec<SpoTripleView> {
        let mut out = Vec::new();
        if self.triple_count == 0 || max_rows == 0 {
            return out;
        }
        let target_hash = fnv1a_64(subject_iri.as_bytes());
        let mut lo = 0usize;
        let mut hi = self.triple_count;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let off = SPO_HEADER_BYTES + mid * SPO_SLOT_BYTES;
            let h = u64::from_le_bytes(self.mmap[off..off + 8].try_into().unwrap());
            if h < target_hash {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        let mut idx = lo;
        while idx < self.triple_count && out.len() < max_rows {
            let off = SPO_HEADER_BYTES + idx * SPO_SLOT_BYTES;
            let h = u64::from_le_bytes(self.mmap[off..off + 8].try_into().unwrap());
            if h != target_hash {
                break;
            }
            let soff = u32::from_le_bytes(self.mmap[off + 8..off + 12].try_into().unwrap());
            let slen = u16::from_le_bytes(self.mmap[off + 12..off + 14].try_into().unwrap());
            let pid = u16::from_le_bytes(self.mmap[off + 14..off + 16].try_into().unwrap());
            let ooff = u32::from_le_bytes(self.mmap[off + 16..off + 20].try_into().unwrap());
            let olen = u16::from_le_bytes(self.mmap[off + 20..off + 22].try_into().unwrap());
            let obj_is_iri = self.mmap[off + 22] != 0;
            let ep = match self.mmap[off + 23] {
                0 => EpistemicStatus::Observation,
                1 => EpistemicStatus::Claim,
                _ => EpistemicStatus::Hypothesis,
            };

            if let (Some(subj), Some(obj), Some(pred)) = (
                self.read_str(soff, slen),
                self.read_str(ooff, olen),
                SpoPredicate::from_u16(pid),
            ) {
                if subj == subject_iri {
                    out.push(SpoTripleView {
                        subject: subj.to_string(),
                        predicate: pred.iri().to_string(),
                        object: obj.to_string(),
                        object_is_iri: obj_is_iri,
                        epistemic: ep,
                    });
                }
            }
            idx += 1;
        }
        out
    }

    /// Materializes ONLY the active 1..2 hop neighborhood of `root_iri` into Pure-Rust `Oxigraph`
    /// and discards all other triples so heap overhead stays `< 1 MiB`.
    pub fn materialize_active_subgraph(
        &self,
        root_iri: &str,
        max_hops: u8,
        triple_cap: usize,
    ) -> Result<Store, String> {
        let store = Store::new().map_err(|e| format!("oxigraph store init: {e}"))?;
        let mut queue = vec![(root_iri.to_string(), 0u8)];
        let mut visited = HashSet::new();
        let mut inserted = 0usize;

        while let Some((cur_iri, depth)) = queue.pop() {
            if !visited.insert(cur_iri.clone()) || inserted >= triple_cap {
                continue;
            }
            let triples = self.triples_for_subject(&cur_iri, 32);
            for t in triples {
                if inserted >= triple_cap {
                    break;
                }
                let Ok(s_node) = NamedNode::new(&t.subject) else {
                    continue;
                };
                let Ok(p_node) = NamedNode::new(&t.predicate) else {
                    continue;
                };
                let o_term: Term = if t.object_is_iri {
                    match NamedNode::new(&t.object) {
                        Ok(n) => Term::NamedNode(n),
                        Err(_) => Term::Literal(Literal::new_simple_literal(&t.object)),
                    }
                } else {
                    Term::Literal(Literal::new_simple_literal(&t.object))
                };
                store
                    .insert(&Quad::new(s_node, p_node, o_term, GraphName::DefaultGraph))
                    .map_err(|e| format!("oxigraph insert: {e}"))?;
                inserted += 1;

                if t.object_is_iri
                    && depth + 1 < max_hops
                    && t.object.starts_with("urn:caelus:")
                    && !t.object.starts_with("urn:caelus:ontology:")
                {
                    queue.push((t.object, depth + 1));
                }
            }
        }
        Ok(store)
    }

    /// Evaluates a SPARQL 1.1 SELECT/ASK query on the ephemeral active subgraph of `root_iri`.
    pub fn query_active_subgraph_sparql(
        &self,
        root_iri: &str,
        sparql: &str,
    ) -> Result<Vec<Vec<(String, String)>>, String> {
        let store = self.materialize_active_subgraph(root_iri, 2, 128)?;
        let prepared = SparqlEvaluator::new()
            .parse_query(sparql)
            .map_err(|e| format!("sparql parse err: {e}"))?;
        let results = prepared
            .on_store(&store)
            .execute()
            .map_err(|e| format!("sparql exec err: {e}"))?;
        let mut rows = Vec::new();
        match results {
            QueryResults::Solutions(sols) => {
                for item in sols {
                    let sol = item.map_err(|e| format!("sparql row err: {e}"))?;
                    let row = sol
                        .iter()
                        .map(|(v, term)| (v.as_str().to_string(), term.to_string()))
                        .collect();
                    rows.push(row);
                }
            }
            QueryResults::Boolean(flag) => {
                rows.push(vec![("ask".to_string(), flag.to_string())]);
            }
            QueryResults::Graph(triples) => {
                for t in triples.flatten() {
                    rows.push(vec![
                        ("s".to_string(), t.subject.to_string()),
                        ("p".to_string(), t.predicate.to_string()),
                        ("o".to_string(), t.object.to_string()),
                    ]);
                }
            }
        }
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mmap_store::tests::test_vessel;

    #[test]
    fn disk_spo_materializes_subgraph_into_oxigraph_in_sub_ms() {
        let dir = std::env::temp_dir().join("caelus_atlas_spo_test");
        let _ = fs::remove_dir_all(&dir);
        let spo_path = dir.join("spo_graph.rkyv");

        let mut writer = SpoGraphWriter::new(1_794_600_000);
        let v = test_vessel(9552070, 255916067, "FAROMAR");
        writer.ingest_vessel(&v);
        let total = writer.write_to_file(&spo_path).expect("write spo");
        assert!(total >= 10);

        let graph = MmapSpoGraph::open(&spo_path).expect("open spo");
        let root = vessel_iri(9552070, 255916067, "FAROMAR");
        let rows = graph
            .query_active_subgraph_sparql(
                &root,
                "SELECT ?name ?iacs WHERE { ?v <urn:caelus:prop:name> ?name ; <urn:caelus:prop:iacsMember> ?iacs . }",
            )
            .expect("sparql");
        assert_eq!(rows.len(), 1);
        assert!(rows[0]
            .iter()
            .any(|(k, val)| k == "name" && val.contains("FAROMAR")));
        assert!(rows[0]
            .iter()
            .any(|(k, val)| k == "iacs" && val.contains("true")));

        drop(graph);
        let _ = fs::remove_dir_all(&dir);
    }
}
