import java.util.Scanner;

public class Main {
    static void readIntoMatrix() {
        Scanner in = new Scanner(System.in);
        Graph g = new AdjMatrixGraph(in.nextInt());
        Graphs.readEdges(in, g);
        int n = g.V(), m = g.E();
    }

    static void searchEdges(Graph g) {
        boolean a = g.hasEdge(2, 3);
        boolean b = g.hasEdge(1, 3);
    }

    static void neighborsOfThree(Graph g) {
        Iterable<Integer> result = g.adj(3);
    }

    static void buildWeightedMatrix() {
        WeightedGraph g = new WeightedMatrixGraph(4);
        g.addEdge(0, 1, 7);
        g.addEdge(0, 2, 3);
        g.addEdge(1, 2, 2);
        g.addEdge(2, 3, 4);
    }

    static void neighborsOfTwo(WeightedGraph g) {
        Iterable<Edge> result = g.adj(2);
    }

    static void buildLists() {
        Graph g = new AdjListGraph(4);
        g.addEdge(0, 1);
        g.addEdge(0, 2);
        g.addEdge(1, 2);
        g.addEdge(2, 3);
    }

    static void buildDigraph() {
        Graph g = new AdjListDigraph(4);
        g.addEdge(0, 1);
        g.addEdge(0, 2);
        g.addEdge(1, 2);
        g.addEdge(2, 3);
    }

    static void inDegreeOfTwo(Graph g) {
        int d = Graphs.inDegree(g, 2);
    }

    static void buildWeightedLists() {
        WeightedGraph g = new WeightedListGraph(4);
        g.addEdge(0, 1, 7);
        g.addEdge(0, 2, 3);
        g.addEdge(1, 2, 2);
        g.addEdge(2, 3, 4);
    }

    static void allDegrees(Graph g) {
        int[] degree = Graphs.degrees(g);
    }

    static void buildByName() {
        NameGraph g = new NameGraph();
        g.addEdge("ana", "beto");
        g.addEdge("ana", "carla");
        g.addEdge("beto", "carla");
        g.addEdge("ana", "beto");
    }
}
