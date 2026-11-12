import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;

interface Graph {
    int V();
    Iterable<Integer> adj(int v);
    void addEdge(int v, int w);
}

class AdjListDigraph implements Graph {
    private final List<List<Integer>> lists = new ArrayList<>();

    AdjListDigraph(int V) {
        for (int v = 0; v < V; v++) {
            lists.add(new ArrayList<>());
        }
    }

    public int V() {
        return lists.size();
    }

    public Iterable<Integer> adj(int v) {
        return new ArrayList<>(lists.get(v));
    }

    public void addEdge(int v, int w) {
        lists.get(v).add(w);
    }
}

class Solution {
    static List<String> order(String[] courses, String[][] prerequisites) {
        Map<String, Integer> index = new HashMap<>();
        for (int v = 0; v < courses.length; v++) {
            index.put(courses[v], v);
        }
        Graph g = new AdjListDigraph(courses.length);
        for (String[] pair : prerequisites) {
            g.addEdge(index.get(pair[0]), index.get(pair[1]));
        }
        int[] inDegree = new int[g.V()];
        for (int v = 0; v < g.V(); v++) {
            for (int w : g.adj(v)) {
                inDegree[w]++;
            }
        }
        Queue<Integer> sources = new ArrayDeque<>();
        for (int v = 0; v < g.V(); v++) {
            if (inDegree[v] == 0) {
                sources.add(v);
            }
        }
        List<String> order = new ArrayList<>();
        while (!sources.isEmpty()) {
            int v = sources.remove();
            order.add(courses[v]);
            for (int w : g.adj(v)) {
                inDegree[w]--;
                if (inDegree[w] == 0) {
                    sources.add(w);
                }
            }
        }
        if (order.size() < g.V()) {
            return new ArrayList<>();
        }
        return order;
    }
}
