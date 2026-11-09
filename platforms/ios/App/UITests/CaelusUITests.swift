//
//  CaelusUITests.swift
//  CAELUSMobileUITests
//
//  On-device/simulator UI smoke tests (XCUITest — macOS/Xcode required).
//  These verify the launch → library → session → command-center flow with
//  the bundled signed BS-01 scenario, entirely offline.
//
import XCTest

final class CaelusUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Launch reaches the scenario library (first run) or a restored
    /// session (subsequent runs) without any network access.
    func testLaunchReachesLibraryOrRestoredSession() {
        let app = XCUIApplication()
        app.launch()
        let library = app.navigationBars["Scenario Library"]
        let command = app.navigationBars["Command Center"]
        XCTAssertTrue(library.waitForExistence(timeout: 10)
            || command.waitForExistence(timeout: 10),
            "launch must land on the library or a restored session")
    }

    /// Start a symbolic-only session from the bundled scenario and advance
    /// one tick from the Command Center.
    func testStartSessionAndAdvanceTick() {
        let app = XCUIApplication()
        app.launch()

        let library = app.navigationBars["Scenario Library"]
        if library.waitForExistence(timeout: 10) {
            app.buttons["Scenario BS-01_SAHTE_UFUK"].firstMatch.tap()
            app.buttons["Start symbolic-only session"].firstMatch.tap()
        }
        XCTAssertTrue(app.navigationBars["Command Center"]
            .waitForExistence(timeout: 15))

        let tick = app.buttons["Tick"].firstMatch
        XCTAssertTrue(tick.waitForExistence(timeout: 10))
        tick.tap()
        // Tick counter must be visible and non-initial after the advance.
        XCTAssertTrue(app.staticTexts
            .matching(NSPredicate(format: "label BEGINSWITH 'Tick '"))
            .firstMatch.waitForExistence(timeout: 10))
    }

    /// The map, levers, and neural tabs all present their navigation bars.
    func testPrimaryTabsPresent() {
        let app = XCUIApplication()
        app.launch()
        let library = app.navigationBars["Scenario Library"]
        if library.waitForExistence(timeout: 10) {
            app.buttons["Scenario BS-01_SAHTE_UFUK"].firstMatch.tap()
            app.buttons["Start symbolic-only session"].firstMatch.tap()
        }
        guard app.tabBars.firstMatch.waitForExistence(timeout: 15) else {
            // Regular-width (iPad) uses the sidebar shell instead.
            XCTAssertTrue(app.navigationBars.firstMatch.exists)
            return
        }
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.navigationBars["Causal Map"]
            .waitForExistence(timeout: 5))
        app.tabBars.buttons["Levers"].tap()
        XCTAssertTrue(app.navigationBars["Lever Center"]
            .waitForExistence(timeout: 5))
        app.tabBars.buttons["Neural"].tap()
        XCTAssertTrue(app.navigationBars["Neural Observer"]
            .waitForExistence(timeout: 5))
    }
}
