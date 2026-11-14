//! Pure-Rust On-Demand `oxigraph` RDF / SPO Maritime Ontology & SPARQL Query Helper.
//!
//! IMPORTANT: `Store` is built lazily on demand and dropped after answering a query
//! so `caelus_ui.exe` keeps zero permanent graph heap overhead (< 45 MiB RAM rule).

use crate::xtdb_bitemporal::PinnedDossier;
use caelus_core::domain::AEGEAN_PORTS;
use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::Store;

/// Builds a fresh in-memory Pure-Rust Oxigraph SPO store containing Aegean corridors,
/// port nodes, and active `PinnedDossier` assertions.
pub fn build_maritime_spo_store(dossiers: &[PinnedDossier]) -> Result<Store, String> {
    let store = Store::new().map_err(|e| format!("oxigraph store init: {e}"))?;

    let rdf_type = NamedNode::new("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
        .map_err(|e| e.to_string())?;
    let port_class =
        NamedNode::new("urn:caelus:ontology:MaritimePort").map_err(|e| e.to_string())?;
    let dossier_class =
        NamedNode::new("urn:caelus:ontology:PinnedDossier").map_err(|e| e.to_string())?;
    let locode_pred = NamedNode::new("urn:caelus:prop:unlocode").map_err(|e| e.to_string())?;
    let name_pred = NamedNode::new("urn:caelus:prop:label").map_err(|e| e.to_string())?;
    let corridor_pred = NamedNode::new("urn:caelus:prop:corridor").map_err(|e| e.to_string())?;

    for port in AEGEAN_PORTS {
        let subj = NamedNode::new(format!("urn:caelus:port:{}", port.unlocode))
            .map_err(|e| e.to_string())?;
        store
            .insert(&Quad::new(
                subj.clone(),
                rdf_type.clone(),
                port_class.clone(),
                GraphName::DefaultGraph,
            ))
            .map_err(|e| e.to_string())?;
        store
            .insert(&Quad::new(
                subj.clone(),
                locode_pred.clone(),
                Literal::new_simple_literal(port.unlocode),
                GraphName::DefaultGraph,
            ))
            .map_err(|e| e.to_string())?;
        store
            .insert(&Quad::new(
                subj,
                name_pred.clone(),
                Literal::new_simple_literal(port.name),
                GraphName::DefaultGraph,
            ))
            .map_err(|e| e.to_string())?;
    }

    for dossier in dossiers {
        let safe_id: String = dossier
            .id
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        let subj =
            NamedNode::new(format!("urn:caelus:dossier:{safe_id}")).map_err(|e| e.to_string())?;
        store
            .insert(&Quad::new(
                subj.clone(),
                rdf_type.clone(),
                dossier_class.clone(),
                GraphName::DefaultGraph,
            ))
            .map_err(|e| e.to_string())?;
        store
            .insert(&Quad::new(
                subj.clone(),
                name_pred.clone(),
                Literal::new_simple_literal(&dossier.title),
                GraphName::DefaultGraph,
            ))
            .map_err(|e| e.to_string())?;
        store
            .insert(&Quad::new(
                subj,
                corridor_pred.clone(),
                Literal::new_simple_literal(&dossier.corridor_code),
                GraphName::DefaultGraph,
            ))
            .map_err(|e| e.to_string())?;
    }

    Ok(store)
}

/// Runs a SPARQL SELECT query against an Oxigraph `Store` and counts matching solutions.
pub fn query_sparql_count(store: &Store, sparql: &str) -> Result<usize, String> {
    let prepared = SparqlEvaluator::new()
        .parse_query(sparql)
        .map_err(|e| format!("sparql parse error: {e}"))?;
    let results = prepared
        .on_store(store)
        .execute()
        .map_err(|e| format!("sparql eval error: {e}"))?;
    match results {
        QueryResults::Solutions(sols) => {
            let mut count = 0usize;
            for item in sols {
                let _ = item.map_err(|e| format!("solution err: {e}"))?;
                count += 1;
            }
            Ok(count)
        }
        QueryResults::Boolean(flag) => Ok(usize::from(flag)),
        QueryResults::Graph(triples) => Ok(triples.count()),
    }
}

/// Convenience one-shot helper that instantiates Oxigraph, evaluates a query, and drops the store.
pub fn query_sparql_summary(dossiers: &[PinnedDossier], sparql: &str) -> Result<usize, String> {
    let store = build_maritime_spo_store(dossiers)?;
    query_sparql_count(&store, sparql)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oxigraph_pure_rust_store_inserts_ports_and_answers_sparql() {
        let dossiers = vec![PinnedDossier {
            id: "DOS-AEGEAN-1".to_string(),
            title: "Seferihisar-Samos Rescue Corridor".to_string(),
            corridor_code: "TR-SEF -> GR-SMI".to_string(),
            created_tx_ms: 1000,
            pinned_npv_keur: 410,
            pinned_action: "ProceedDirect".to_string(),
            notes: "Verified".to_string(),
        }];
        let sparql_ports = "SELECT ?p ?code WHERE { ?p <urn:caelus:prop:unlocode> ?code . }";
        let port_count = query_sparql_summary(&dossiers, sparql_ports).expect("sparql ports");
        assert_eq!(port_count, AEGEAN_PORTS.len());

        let sparql_dossiers = "SELECT ?d WHERE { ?d a <urn:caelus:ontology:PinnedDossier> . }";
        let dos_count = query_sparql_summary(&dossiers, sparql_dossiers).expect("sparql dossier");
        assert_eq!(dos_count, 1);
    }
}
