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
