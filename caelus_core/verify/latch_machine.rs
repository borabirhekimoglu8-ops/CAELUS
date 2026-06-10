// CAELUS OS — P-5 OUTAGE LATCH DURUM MAKİNESİ İZ İSPATI (ispat dalgası 2)
//
// Doğrulama: tools\verus\verus-x86-win\verus.exe --crate-type=lib caelus_core\verify\latch_machine.rs
//
// MOTOR BAĞLAMA (engine.rs ↔ model):
//   `outage` alanına yazan TÜM motor yolları şu olaylara soyutlanır:
//     NonReversibleFlip       — check_hysteresis: reversible=false flip → latch_outage()
//     PerishableDeadlineMiss  — check_deadlines: Perishable miss → latch_outage()
//     NeutralTickEffect       — propagasyon/feedback/trust/regime: outage'a DOKUNMAZ
//     LeverNonClearing        — başarısız lever veya clear_irrecoverable'sız sonuç
//     LeverSuccessClear       — apply_lever: success ∧ clear_irrecoverable
//                               → clear_outage_recovery() (outage=false yazan TEK yol)
//   Bu soyutlamanın gerçek motora bağı: tests/invariant_sweep.rs (I-2, her adım)
//   ve engine.rs'teki tek clear_outage_recovery çağrı yeri (apply_lever).
//
// TEOREMLER (iz düzeyinde, HER uzunlukta olay dizisi için):
//   P-5a latch_unidirectional : outage kuruluyken iz sonunda düşmüşse,
//                               izde mutlaka LeverSuccessClear vardır.
//   P-5b no_clear_no_recovery : LeverSuccessClear içermeyen hiçbir iz,
//                               kurulu outage'ı düşüremez.
//   Birlikte: outage'ın temizlenmesi ⟺ açık recovery lever olayı (T-20'nin
//   makine-denetimli evrensel hâli).

use vstd::prelude::*;

verus! {

pub enum EngineEvent {
    NonReversibleFlip,
    PerishableDeadlineMiss,
    NeutralTickEffect,
    LeverNonClearing,
    LeverSuccessClear,
}

/// Tek adımın outage etkisi — engine.rs yollarının spesifikasyonu.
pub open spec fn step_spec(pre: bool, ev: EngineEvent) -> bool {
    match ev {
        EngineEvent::NonReversibleFlip => true,        // latch_outage()
        EngineEvent::PerishableDeadlineMiss => true,   // latch_outage()
        EngineEvent::NeutralTickEffect => pre,         // dokunmaz
        EngineEvent::LeverNonClearing => pre,          // dokunmaz
        EngineEvent::LeverSuccessClear => false,       // clear_outage_recovery()
    }
}

/// Exec transkripsiyon: spesifikasyonu gerçekleyen adım fonksiyonu
/// (motorun latch/clear çağrı deseninin minimal eşleniği).
pub struct OutageState {
    pub outage: bool,
}

pub fn engine_step(s: &mut OutageState, ev: &EngineEvent)
    ensures
        final(s).outage == step_spec(old(s).outage, *ev),
{
    match ev {
        EngineEvent::NonReversibleFlip => {
            s.outage = true;
        }
        EngineEvent::PerishableDeadlineMiss => {
            s.outage = true;
        }
        EngineEvent::LeverSuccessClear => {
            s.outage = false;
        }
        EngineEvent::NeutralTickEffect => {}
        EngineEvent::LeverNonClearing => {}
    }
}

/// İz semantiği: init durumundan olay dizisini koş.
pub open spec fn run_spec(init: bool, tr: Seq<EngineEvent>) -> bool
    decreases tr.len(),
{
    if tr.len() == 0 {
        init
    } else {
        step_spec(run_spec(init, tr.drop_last()), tr.last())
    }
}

pub open spec fn contains_clear(tr: Seq<EngineEvent>) -> bool {
    exists|i: int| 0 <= i < tr.len() && tr[i] is LeverSuccessClear
}

/// P-5a TEOREMİ: kurulu outage iz sonunda düşmüşse iz clear olayı içerir.
pub proof fn latch_unidirectional(init: bool, tr: Seq<EngineEvent>)
    requires
        init,
        !run_spec(init, tr),
    ensures
        contains_clear(tr),
    decreases tr.len(),
{
    if tr.len() == 0 {
        // run == init == true ile !run çelişir.
        assert(false);
    } else {
        let prefix = tr.drop_last();
        let last = tr.last();
        match last {
            EngineEvent::LeverSuccessClear => {
                assert(tr[tr.len() - 1] is LeverSuccessClear);
            }
            EngineEvent::NonReversibleFlip | EngineEvent::PerishableDeadlineMiss => {
                // step true döndürürdü → !run ile çelişki.
                assert(false);
            }
            _ => {
                // Nötr adım: run == run_spec(prefix) → önek de düşmüş olmalı.
                latch_unidirectional(init, prefix);
                let i = choose|i: int| 0 <= i < prefix.len() && prefix[i] is LeverSuccessClear;
                assert(tr[i] is LeverSuccessClear);
            }
        }
    }
}

/// Yardımcı: iz clear içermiyorsa öneki de içermez.
pub proof fn no_clear_in_prefix(tr: Seq<EngineEvent>)
    requires
        tr.len() > 0,
        !contains_clear(tr),
    ensures
        !contains_clear(tr.drop_last()),
{
    let prefix = tr.drop_last();
    if contains_clear(prefix) {
        let i = choose|i: int| 0 <= i < prefix.len() && prefix[i] is LeverSuccessClear;
        assert(tr[i] is LeverSuccessClear);
        assert(false);
    }
}

/// P-5b TEOREMİ: clear olayı içermeyen hiçbir iz kurulu outage'ı düşüremez.
pub proof fn no_clear_no_recovery(init: bool, tr: Seq<EngineEvent>)
    requires
        init,
        !contains_clear(tr),
    ensures
        run_spec(init, tr),
    decreases tr.len(),
{
    if tr.len() == 0 {
        // run == init == true ✓
    } else {
        let prefix = tr.drop_last();
        let last = tr.last();
        // last clear olamaz (iz clear içermiyor).
        assert(!(tr[tr.len() - 1] is LeverSuccessClear));
        match last {
            EngineEvent::NonReversibleFlip | EngineEvent::PerishableDeadlineMiss => {
                // step her durumda true → run true ✓
            }
            _ => {
                no_clear_in_prefix(tr);
                no_clear_no_recovery(init, prefix);
                // run == run_spec(prefix) == true ✓
            }
        }
    }
}

} // verus!
