use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use caelus_core::engine::{
    CausalEngine, Edge, FeedbackLoop, Hysteresis, IntelBinding, IntelBindingMode, Lever,
    LeverOutcome, Node, NodeKind,
};
use caelus_core::fp::FP_ONE;

struct CountingAlloc;

static COUNT_ACTIVE: AtomicBool = AtomicBool::new(false);
static ALLOC_CALLS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if COUNT_ACTIVE.load(Ordering::Relaxed) {
            ALLOC_CALLS.fetch_add(1, Ordering::Relaxed);
        }
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if COUNT_ACTIVE.load(Ordering::Relaxed) {
            ALLOC_CALLS.fetch_add(1, Ordering::Relaxed);
        }
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

#[test]
fn hot_path_simulation_performs_zero_heap_allocations() {
    let mut eng = CausalEngine::new();
    eng.set_prng_seed(0xCAE1_05DE_ADBE_EF00);

    let mut n1 = Node::default();
    n1.id = String::from("N1");
    n1.kind = NodeKind::Service;
    n1.capacity_fp = FP_ONE;
    n1.state_fp = 450_000;
    n1.reported_state_fp = 450_000;
    n1.weight_fp = 400_000;
    eng.add_node(n1);

    let mut n2 = Node::default();
    n2.id = String::from("N2");
    n2.kind = NodeKind::Queue;
    n2.capacity_fp = FP_ONE;
    n2.state_fp = 300_000;
    n2.reported_state_fp = 100_000; // triggers trust update
    n2.weight_fp = 350_000;
    n2.deadline_tick = 10;
    eng.add_node(n2);

    eng.add_edge(Edge {
        from: String::from("N1"),
        to: String::from("N2"),
        multiplier_fp: 800_000,
        lag_ticks: 0,
        active: true,
    });
    eng.add_edge(Edge {
        from: String::from("N2"),
        to: String::new(),
        multiplier_fp: 250_000,
        lag_ticks: 1,
        active: true,
    });
    eng.add_loop(FeedbackLoop {
        id: String::from("LOOP_1"),
        path: vec![String::from("N1"), String::from("N2")],
        gain_fp: 1_250_000,
    });
    eng.add_hysteresis(Hysteresis {
        id: String::from("HYST_1"),
        threshold_tick: 5,
        reversible: true,
        permanent_loss_fp: 100_000,
        min_friction_fp: FP_ONE,
        condition_node_id: String::from("N1"),
        min_node_state_fp: 200_000,
        flipped: false,
    });
    eng.add_intel_binding(IntelBinding {
        node_id: String::from("N1"),
        mode: IntelBindingMode::Max,
        scale_fp: 900_000,
        crisis_step_fp: 50_000,
        min_crisis_level: 1,
    });
    eng.add_lever(Lever {
        id: String::from("LEV_1"),
        target: String::from("N2"),
        success_p_fp: FP_ONE,
        cost_ticks: 2,
        lockout_ticks: 1,
        on_success: LeverOutcome {
            target_node_id: String::from("N2"),
            state_delta_fp: -100_000,
            trust_delta_fp: 50_000,
            friction_delta_fp: -20_000,
            clear_irrecoverable: true,
        },
        on_failure: LeverOutcome::default(),
        remaining_lockout: 0,
        available: true,
    });

    ALLOC_CALLS.store(0, Ordering::SeqCst);
    COUNT_ACTIVE.store(true, Ordering::SeqCst);

    for _ in 0..32 {
        eng.step_tick();
    }
    let _ = eng.inject_intel_fp(750_000, 2, "airgapped_field");
    let _ = eng.apply_lever("LEV_1", 0);
    for _ in 0..32 {
        eng.step_tick();
    }

    COUNT_ACTIVE.store(false, Ordering::SeqCst);
    let allocs = ALLOC_CALLS.load(Ordering::SeqCst);
    assert_eq!(
        allocs, 0,
        "simulation hot path must allocate zero heap blocks, saw {}",
        allocs
    );
}

