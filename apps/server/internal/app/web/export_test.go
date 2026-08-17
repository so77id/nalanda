package web

// RoutesForTest exposes the table to this package's own guards.
//
// Exported rather than reached from inside the package because the guard has to
// drive the router through its public surface — a test that walked an internal
// list and called handlers directly would pass on a Router that never mounted
// them (#149 review, F7, one layer down).
func RoutesForTest(deps Deps) []Route { return routes(deps) }
