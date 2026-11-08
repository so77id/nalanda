import java.util.Scanner;

public class Graphs {
    static void readEdges(Scanner in, Graph g) {
        int E = in.nextInt();
        for (int i = 0; i < E; i++) {
            int v = in.nextInt();
            int w = in.nextInt();
            g.addEdge(v, w);
        }
    }

    static int degree(Graph g, int v) {
        int count = 0;
        for (int w : g.adj(v)) {
            count++;
        }
        return count;
    }

    static int inDegree(Graph g, int v) {
        int count = 0;
        for (int u = 0; u < g.V(); u++) {
            for (int w : g.adj(u)) {
                if (w == v) {
                    count++;
                }
            }
        }
        return count;
    }

    static int[] degrees(Graph g) {
        int[] degree = new int[g.V()];
        for (int v = 0; v < g.V(); v++) {
            for (int w : g.adj(v)) {
                degree[v]++;
            }
        }
        return degree;
    }

    static void readWeightedEdges(Scanner in, WeightedGraph g) {
        int E = in.nextInt();
        for (int i = 0; i < E; i++) {
            int v = in.nextInt();
            int w = in.nextInt();
            int weight = in.nextInt();
            g.addEdge(v, w, weight);
        }
    }
}
