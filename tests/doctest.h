// CAELUS OS test-only header.
//
// This is a deliberately small doctest-compatible harness, not the full upstream
// doctest distribution. It supports the subset used by CAELUS C++ unit tests and
// is included only by test translation units.
#pragma once

#include <exception>
#include <functional>
#include <iostream>
#include <string>
#include <vector>

namespace doctest {
namespace detail {

struct TestCase {
    const char* name;
    void (*fn)();
};

inline std::vector<TestCase>& registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Registrar {
    Registrar(const char* name, void (*fn)()) {
        registry().push_back({name, fn});
    }
};

struct TestFailure : std::exception {
    const char* what() const noexcept override { return "doctest assertion failed"; }
};

inline int& assertion_count() {
    static int count = 0;
    return count;
}

inline int& failure_count() {
    static int count = 0;
    return count;
}

inline void check(bool passed, const char* expr, const char* file, int line, bool fatal) {
    ++assertion_count();
    if (passed) return;

    ++failure_count();
    std::cerr << file << ":" << line << ": CHECK failed: " << expr << "\n";
    if (fatal) throw TestFailure{};
}

inline int run_all_tests() {
    int failed_cases = 0;
    for (const auto& test : registry()) {
        try {
            test.fn();
            std::cout << "[doctest] PASS " << test.name << "\n";
        } catch (const TestFailure&) {
            ++failed_cases;
            std::cerr << "[doctest] FAIL " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed_cases;
            ++failure_count();
            std::cerr << "[doctest] FAIL " << test.name << ": " << ex.what() << "\n";
        } catch (...) {
            ++failed_cases;
            ++failure_count();
            std::cerr << "[doctest] FAIL " << test.name << ": unknown exception\n";
        }
    }

    std::cout << "[doctest] " << registry().size() << " test case(s), "
              << assertion_count() << " assertion(s), "
              << failure_count() << " failure(s)\n";
    return failed_cases == 0 && failure_count() == 0 ? 0 : 1;
}

/**
 * SubcaseScope — labels the currently running subcase so failures are
 * attributable, and evaluates truthy inside `if` so SUBCASE reads naturally.
 */
struct SubcaseScope {
    explicit SubcaseScope(const char* name) {
        std::cout << "[doctest]   subcase: " << name << "\n";
    }
    explicit operator bool() const { return true; }
};

} // namespace detail
} // namespace doctest

#define DOCTEST_DETAIL_CAT_IMPL(a, b) a##b
#define DOCTEST_DETAIL_CAT(a, b) DOCTEST_DETAIL_CAT_IMPL(a, b)

#define TEST_CASE(name)                                                        \
    static void DOCTEST_DETAIL_CAT(doctest_test_, __LINE__)();                 \
    static ::doctest::detail::Registrar                                        \
        DOCTEST_DETAIL_CAT(doctest_registrar_, __LINE__)(                      \
            name, &DOCTEST_DETAIL_CAT(doctest_test_, __LINE__));               \
    static void DOCTEST_DETAIL_CAT(doctest_test_, __LINE__)()

#define CHECK(expr)                                                            \
    ::doctest::detail::check(static_cast<bool>(expr), #expr, __FILE__,         \
                             __LINE__, false)

#define REQUIRE(expr)                                                          \
    ::doctest::detail::check(static_cast<bool>(expr), #expr, __FILE__,         \
                             __LINE__, true)

#define REQUIRE_MESSAGE(expr, msg)                                             \
    ::doctest::detail::check(static_cast<bool>(expr), (msg), __FILE__,         \
                             __LINE__, true)

// SUBCASE — sequential-execution semantics.
//
// Upstream doctest re-enters the enclosing TEST_CASE once per subcase.  This
// harness instead executes every subcase block in a single pass, in order.
// That is only equivalent when subcase blocks are self-contained (create
// their own fixtures and do not rely on re-initialised enclosing state) —
// the convention all CAELUS tests using SUBCASE must follow.
#define SUBCASE(name)                                                          \
    if (::doctest::detail::SubcaseScope DOCTEST_DETAIL_CAT(                    \
            doctest_subcase_, __LINE__){name})

#ifdef DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
int main() {
    return ::doctest::detail::run_all_tests();
}
#endif
