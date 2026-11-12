import java.util.Scanner;

public class PowerOutage {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int V = in.nextInt();
        Graph g = new AdjListGraph(V);
        Graphs.readEdges(in, g);
        DepthFirstSearch search = new DepthFirstSearch(g, 0);
        for (int v = 1; v < V; v++) {
            if (!search.marked(v)) {
                System.out.println(v);
            }
        }
    }
}
