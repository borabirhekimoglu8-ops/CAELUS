/* SwiftPM requires at least one compiled source in a C target.  The anchor
 * has no runtime role; every real symbol comes from the linked native core
 * (CaelusCore.xcframework on Apple platforms, dist/host archives on Linux). */
int caelus_bridge_c_anchor(void) { return 1; }
