//! Lightweight E-Graph / Union-Find Congruence Closure engine in Pure Rust
//! for deterministic maritime & operational rule equivalence checking.

use std::collections::{HashMap, HashSet};

pub type EClassId = usize;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ENode {
    pub op: String,
    pub children: Vec<EClassId>,
}

#[derive(Debug, Default, Clone)]
pub struct EGraph {
    parent: Vec<EClassId>,
    nodes: HashMap<ENode, EClassId>,
}

impl EGraph {
    /// Creates an empty congruence-closure e-graph.
    pub fn new() -> Self {
        Self::default()
    }

    /// Finds the canonical representative for `id` with path compression.
    pub fn find(&mut self, mut id: EClassId) -> EClassId {
        while self.parent[id] != id {
            self.parent[id] = self.parent[self.parent[id]];
            id = self.parent[id];
        }
        id
    }

    /// Interns an operator and canonicalized child e-classes, returning its e-class id.
    pub fn add(&mut self, op: &str, children: Vec<EClassId>) -> EClassId {
        let canon_children: Vec<EClassId> = children.into_iter().map(|c| self.find(c)).collect();
        let node = ENode {
            op: op.to_string(),
            children: canon_children,
        };
        if let Some(&existing) = self.nodes.get(&node) {
            return self.find(existing);
        }
        let id = self.parent.len();
        self.parent.push(id);
        self.nodes.insert(node, id);
        id
    }

    /// Merges two e-classes into the same equivalence class.
    pub fn union(&mut self, a: EClassId, b: EClassId) -> EClassId {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra != rb {
            self.parent[rb] = ra;
        }
        ra
    }

    /// Restores congruence closure invariant after unions by canonicalizing node children.
    pub fn rebuild(&mut self) {
        loop {
            let mut merged_any = false;
            let entries: Vec<(ENode, EClassId)> = self.nodes.drain().collect();
            let mut rebuilt: HashMap<ENode, EClassId> = HashMap::with_capacity(entries.len());

            for (node, class_id) in entries {
                let canon_node = ENode {
                    op: node.op,
                    children: node.children.into_iter().map(|c| self.find(c)).collect(),
                };
                let canon_id = self.find(class_id);
                if let Some(&existing) = rebuilt.get(&canon_node) {
                    let existing_root = self.find(existing);
                    if existing_root != canon_id {
                        self.union(existing_root, canon_id);
                        merged_any = true;
                    }
                } else {
                    rebuilt.insert(canon_node, canon_id);
                }
            }
            self.nodes = rebuilt;
            if !merged_any {
                break;
            }
        }
    }

    /// Returns `true` if `a` and `b` reside in the same equivalence class.
    pub fn are_equivalent(&mut self, a: EClassId, b: EClassId) -> bool {
        self.find(a) == self.find(b)
    }

    /// Counts distinct equivalence classes currently present.
    pub fn num_classes(&mut self) -> usize {
        let n = self.parent.len();
        let mut roots = HashSet::new();
        for i in 0..n {
            roots.insert(self.find(i));
        }
        roots.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashcons_and_congruence_closure_hold() {
        let mut eg = EGraph::new();
        let pier_a = eg.add("pier_a", vec![]);
        let pier_b = eg.add("pier_b", vec![]);
        let pier_b_dup = eg.add("pier_b", vec![]);
        assert_eq!(pier_b, pier_b_dup);

        let route_a = eg.add("berth_route", vec![pier_a]);
        let route_b = eg.add("berth_route", vec![pier_b]);
        assert!(!eg.are_equivalent(route_a, route_b));

        // Once pier_a and pier_b are declared equivalent operational targets, rebuild closes congruence.
        eg.union(pier_a, pier_b);
        eg.rebuild();
        assert!(eg.are_equivalent(route_a, route_b));
        assert_eq!(eg.num_classes(), 2);
    }
}
