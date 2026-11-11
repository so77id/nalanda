import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

class Solution {
    static String suggest(String[] friendships, String user) {
        Map<String, Integer> ids = new HashMap<>();
        List<String> names = new ArrayList<>();
        for (String line : friendships) {
            for (String name : line.split(" ")) {
                if (!ids.containsKey(name)) {
                    ids.put(name, names.size());
                    names.add(name);
                }
            }
        }
        Graph g = new AdjListGraph(names.size());
        for (String line : friendships) {
            String[] pair = line.split(" ");
            g.addEdge(ids.get(pair[0]), ids.get(pair[1]));
        }
        int u = ids.get(user);
        boolean[] friend = new boolean[g.V()];
        for (int f : g.adj(u)) {
            friend[f] = true;
        }
        int[] common = new int[g.V()];
        for (int f : g.adj(u)) {
            for (int x : g.adj(f)) {
                if (x != u && !friend[x]) {
                    common[x]++;
                }
            }
        }
        int best = -1;
        int most = 0;
        for (int x = 0; x < g.V(); x++) {
            if (common[x] > most) {
                most = common[x];
                best = x;
            }
        }
        return best == -1 ? null : names.get(best);
    }
}
