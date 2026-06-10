/**
 * CAELUS OS — Solver Abstraction  (include/plugin/caelus_solver.h)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ZERO-COST ABSTRACTION ARCHITECTURE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The solver layer has TWO tiers:
 *
 *  Tier 1 — C ABI vtable (caelus_plugin_abi.h):
 *    Runtime-loadable contract.  Used when the engine dispatches to a solver
 *    through the PluginRegistry.  One indirect call per solve() invocation
 *    (the only overhead — acceptable for a ~10 ms computation).
 *
 *  Tier 2 — CRTP C++ wrappers (this file):
 *    Compile-time polymorphism.  Built-in solvers (DeterministicSolver,
 *    ORToolsSolver) are concrete structs with NO virtual functions.
 *    `make_solver_vtable<T>()` converts them to a static ABI VTable at
 *    zero runtime cost — the static const struct lives in .rodata.
 *
 * Solver selection:
 *    `ActiveSolver` is a std::variant that holds exactly ONE built-in solver.
 *    std::visit dispatches to it with a single switch — no heap, no RTTI,
 *    no virtual calls for the internal hot path.
 *    External plugins registered at runtime use the vtable path.
 *
 * Adding a new solver:
 *   1. Define `struct MySolver` with `kName`, `kVersion`, `do_solve()`.
 *   2. Add `MySolver` to the `ActiveSolver` variant alias.
 *   3. Call `g_registry.set_solver(make_solver_vtable<MySolver>())`.
 *   Done — no other file changes needed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

#pragma once

#include "caelus_plugin_abi.h"
#include <cstring>
#include <algorithm>
#include <variant>
#include <cstdint>

#ifdef CAELUS_WITH_ORTOOLS
#  include <ortools/sat/cp_model.h>
   using namespace operations_research::sat;
#endif

namespace caelus {

// ─────────────────────────────────────────────────────────────────────────────
// C++ request / result wrappers
// (Constructed from C ABI structs; provide named accessors and defaults.)
// ─────────────────────────────────────────────────────────────────────────────

/** C++ view of CaelusSolverRequest — adds convenience constructors. */
struct SolverRequest {
    double  friction_multiplier   = 1.0;
    int     task_start_min        = 360;   // 06:00
    int     target_deadline_min   = 480;   // 08:00
    int     commit_overhead_min   = 30;
    int     base_transit_low_min  = 45;
    int     base_transit_high_min = 65;

    SolverRequest() = default;

    explicit SolverRequest(const CaelusSolverRequest& c) noexcept
        : friction_multiplier  (c.friction_multiplier)
        , task_start_min       (c.task_start_min)
        , target_deadline_min  (c.target_deadline_min)
        , commit_overhead_min  (c.commit_overhead_min)
        , base_transit_low_min (c.base_transit_low_min)
        , base_transit_high_min(c.base_transit_high_min) {}

    CaelusSolverRequest to_c() const noexcept {
        CaelusSolverRequest r{};
        r.friction_multiplier   = friction_multiplier;
        r.task_start_min        = task_start_min;
        r.target_deadline_min   = target_deadline_min;
        r.commit_overhead_min   = commit_overhead_min;
        r.base_transit_low_min  = base_transit_low_min;
        r.base_transit_high_min = base_transit_high_min;
        return r;
    }

    /** Travel band after applying the friction multiplier. */
    int travel_low () const noexcept {
        int tl = static_cast<int>(base_transit_low_min  * friction_multiplier);
        return tl < 1 ? 1 : tl;
    }
    int travel_high() const noexcept {
        int th = static_cast<int>(base_transit_high_min * friction_multiplier);
        int tl = travel_low();
        return th < tl ? tl : th;
    }
};

/** C++ view of CaelusSolverResult — adds copy-to-C helper. */
struct SolverResult {
    int  travel_low     = 0;
    int  travel_high    = 0;
    int  arrival        = 0;
    int  completion     = 0;
    bool on_time        = false;
    bool feasible       = true;
    bool regime_exceeded= false;

    CaelusSolverResult to_c() const noexcept {
        CaelusSolverResult r{};
        r.travel_low       = travel_low;
        r.travel_high      = travel_high;
        r.arrival_min      = arrival;
        r.completion_min   = completion;
        r.on_time          = on_time  ? 1 : 0;
        r.feasible         = feasible ? 1 : 0;
        r.regime_exceeded  = regime_exceeded ? 1 : 0;
        std::strncpy(r.status_msg, feasible ? "SOLVED" : "INFEASIBLE", 63);
        r.status_msg[63] = '\0';
        return r;
    }

    static SolverResult from_c(const CaelusSolverResult& c) noexcept {
        SolverResult r;
        r.travel_low      = c.travel_low;
        r.travel_high     = c.travel_high;
        r.arrival         = c.arrival_min;
        r.completion      = c.completion_min;
        r.on_time         = c.on_time        != 0;
        r.feasible        = c.feasible       != 0;
        r.regime_exceeded = c.regime_exceeded!= 0;
        return r;
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// CRTP base — zero-cost polymorphism for built-in solvers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SolverBase<Derived>
 *
 * The CRTP base every built-in solver inherits from.  Provides the public
 * `solve()` API and the `make_vtable()` factory (generates a static C ABI
 * VTable in .rodata — zero heap allocation).
 *
 * Derived must implement:
 *   static constexpr const char* kName;
 *   static constexpr const char* kVersion;
 *   SolverResult do_solve(const SolverRequest&) const noexcept;
 */
template<typename Derived>
struct SolverBase {
    /** C++ solve path (zero-cost — resolves to Derived::do_solve at compile time). */
    [[nodiscard]] SolverResult solve(const SolverRequest& req) const noexcept {
        return static_cast<const Derived*>(this)->do_solve(req);
    }

    /**
     * Generate (or retrieve the already-generated) C ABI VTable for this solver.
     * The returned pointer points to a function-local static — lives in .rodata,
     * no heap allocation, safe across translation units.
     */
    static const CaelusPluginVTable* make_vtable() noexcept {
        // Trivial lifecycle stubs for stateless solvers.
        static constexpr auto trivial_init = [](void*, const CaelusEngineFns*) -> uint8_t {
            return 1;
        };
        static constexpr auto trivial_cleanup = [](void*) noexcept {};

        // solve_c: adapts the C ABI call to the C++ do_solve().
        // Captureless lambda → decays to plain function pointer.
        static constexpr auto solve_c =
            [](const CaelusSolverRequest* req, CaelusSolverResult* out) -> uint8_t {
                if (!req || !out) return 0;
                // Stateless: construct temporary Derived instance on the stack.
                Derived instance{};
                SolverRequest  cpp_req(*req);
                SolverResult   cpp_res = instance.do_solve(cpp_req);
                *out = cpp_res.to_c();
                return 1;
            };

        static const CaelusPluginVTable kVTable = [&]() {
            CaelusPluginVTable v{};
            v.abi_version  = CAELUS_PLUGIN_ABI_VERSION;
            v.plugin_class = CAELUS_PLUGIN_SOLVER;
            v.name         = Derived::kName;
            v.version      = Derived::kVersion;
            v.init         = trivial_init;
            v.cleanup      = trivial_cleanup;
            v.on_tick      = nullptr;
            v.on_intel     = nullptr;
            v.solve        = solve_c;
            v.pull_intel   = nullptr;
            v.report       = nullptr;
            return v;
        }();
        return &kVTable;
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// Built-in Solver 1: DeterministicSolver (always available)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DeterministicSolver
 *
 * Evaluates the WORST-CASE travel band edge (no search required).
 * Fully deterministic, zero allocation, ~O(1) computation.
 *
 * This is the guaranteed fallback when OR-Tools is not linked.
 * In --det-mode it is always used regardless of OR-Tools presence
 * (the CI result must be independent of the solver engine).
 */
struct DeterministicSolver : SolverBase<DeterministicSolver> {
    static constexpr const char* kName    = "DeterministicSolver";
    static constexpr const char* kVersion = "1.0.0";

    [[nodiscard]] SolverResult do_solve(const SolverRequest& req) const noexcept {
        SolverResult res;
        res.travel_low   = req.travel_low();
        res.travel_high  = req.travel_high();
        // Worst-case: use the upper bound of the travel band.
        res.arrival      = req.task_start_min + res.travel_high;
        res.completion   = res.arrival + req.commit_overhead_min;
        res.on_time      = res.completion <= req.target_deadline_min;
        res.feasible     = true;
        res.regime_exceeded = false;
        return res;
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// Built-in Solver 2: ORToolsSolver (only when CAELUS_WITH_ORTOOLS is defined)
// ─────────────────────────────────────────────────────────────────────────────

#ifdef CAELUS_WITH_ORTOOLS

/**
 * ORToolsSolver
 *
 * Uses Google OR-Tools CP-SAT to minimise the earliest feasible cycle
 * completion time.  The solver always finds a solution (both hard-deadline
 * and at-risk cases); the on_time flag indicates whether it fits the window.
 *
 * Computation:  ≈ 1–5 ms per call on typical hardware (model is tiny).
 * Thread safety: SolveCpModel is re-entrant; multiple instances may call it
 *               concurrently (each call owns its own Model object).
 */
struct ORToolsSolver : SolverBase<ORToolsSolver> {
    static constexpr const char* kName    = "ORToolsSolver (CP-SAT)";
    static constexpr const char* kVersion = "1.0.0";

    [[nodiscard]] SolverResult do_solve(const SolverRequest& req) const noexcept {
        SolverResult res;
        res.travel_low  = req.travel_low();
        res.travel_high = req.travel_high();

        CpModelBuilder cp;
        IntVar travel_time  = cp.NewIntVar(Domain(res.travel_low, res.travel_high))
                                .WithName("travel_time");
        IntVar arrival     = cp.NewIntVar(Domain(0, 2000)).WithName("arrival");
        IntVar completion  = cp.NewIntVar(Domain(0, 2000)).WithName("completion");

        cp.AddEquality(arrival,
            LinearExpr::Term(travel_time, 1).AddConstant(req.task_start_min));
        cp.AddEquality(completion,
            LinearExpr::Term(arrival, 1).AddConstant(req.commit_overhead_min));
        // Minimise cycle completion — gives the best achievable time.
        cp.Minimize(completion);

        Model model;
        const CpSolverResponse response = SolveCpModel(cp.Build(), &model);

        if (response.status() == CpSolverStatus::OPTIMAL ||
            response.status() == CpSolverStatus::FEASIBLE) {
            res.arrival      = static_cast<int>(SolutionIntegerValue(response, arrival));
            res.completion   = static_cast<int>(SolutionIntegerValue(response, completion));
            res.on_time      = res.completion <= req.target_deadline_min;
            res.feasible     = true;
        } else {
            // No feasible solution — report worst case as infeasible.
            res.arrival      = req.task_start_min + res.travel_high;
            res.completion   = res.arrival + req.commit_overhead_min;
            res.on_time      = false;
            res.feasible     = false;
        }
        res.regime_exceeded = false;
        return res;
    }
};

#endif /* CAELUS_WITH_ORTOOLS */


// ─────────────────────────────────────────────────────────────────────────────
// ActiveSolver — runtime solver selection (zero-cost via std::visit)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ActiveSolver holds exactly one built-in solver on the stack (no heap).
 * std::visit dispatches to the correct variant with a single discriminant
 * switch — the compiler can inline the call body.
 *
 * External solver plugins registered via the PluginRegistry go through the
 * vtable path (caelus_plugin_abi.h), which is the correct trade-off: built-ins
 * get zero-cost, external plugins accept one indirect call.
 */
#ifdef CAELUS_WITH_ORTOOLS
using ActiveSolverVariant = std::variant<DeterministicSolver, ORToolsSolver>;
#else
using ActiveSolverVariant = std::variant<DeterministicSolver>;
#endif

struct ActiveSolver {
    ActiveSolverVariant impl;

    /** Construct with the best available built-in solver. */
    static ActiveSolver make_default() noexcept {
#ifdef CAELUS_WITH_ORTOOLS
        return ActiveSolver{ ORToolsSolver{} };
#else
        return ActiveSolver{ DeterministicSolver{} };
#endif
    }

    /** Force deterministic solver regardless of build flags (used by --det-mode). */
    static ActiveSolver make_deterministic() noexcept {
        return ActiveSolver{ DeterministicSolver{} };
    }

    /** Run the active solver (zero-cost dispatch via std::visit). */
    [[nodiscard]] SolverResult solve(const SolverRequest& req) const noexcept {
        return std::visit(
            [&](const auto& s) noexcept { return s.solve(req); },
            impl);
    }

    /** Get the C ABI vtable for the active solver (for plugin registry use). */
    const CaelusPluginVTable* vtable() const noexcept {
        return std::visit(
            [](const auto& s) noexcept {
                using T = std::decay_t<decltype(s)>;
                return T::make_vtable();
            },
            impl);
    }

    const char* name() const noexcept { return vtable()->name; }
};

} // namespace caelus
