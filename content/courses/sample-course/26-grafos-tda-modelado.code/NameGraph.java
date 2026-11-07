import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class NameGraph {
    Map<String, Set<String>> adj = new HashMap<>();

    void addEdge(String v, String w) {
        if (!adj.containsKey(v)) {
            adj.put(v, new HashSet<>());
        }
        if (!adj.containsKey(w)) {
            adj.put(w, new HashSet<>());
        }
        adj.get(v).add(w);
        adj.get(w).add(v);
    }
}
