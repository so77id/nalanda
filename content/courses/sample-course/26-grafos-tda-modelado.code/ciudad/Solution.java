import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

class Solution {
    static String[] nearest(String[] roads) {
        Map<String, Integer> ids = new HashMap<>();
        List<String> names = new ArrayList<>();
        for (String line : roads) {
            String[] parts = line.split(" ");
            for (int i = 0; i < 2; i++) {
                if (!ids.containsKey(parts[i])) {
                    ids.put(parts[i], names.size());
                    names.add(parts[i]);
                }
            }
        }
        WeightedGraph g =
                new WeightedListGraph(names.size());
        for (String line : roads) {
            String[] parts = line.split(" ");
            g.addEdge(ids.get(parts[0]),
                    ids.get(parts[1]),
                    Integer.parseInt(parts[2]));
        }
        String[] result = new String[g.V()];
        for (int v = 0; v < g.V(); v++) {
            Edge best = null;
            for (Edge e : g.adj(v)) {
                if (best == null
                        || e.weight < best.weight) {
                    best = e;
                }
            }
            result[v] = names.get(best.to);
        }
        return result;
    }
}
