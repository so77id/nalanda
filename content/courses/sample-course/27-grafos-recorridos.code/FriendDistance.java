import java.util.Scanner;

public class FriendDistance {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int V = in.nextInt();
        Graph g = new AdjListGraph(V);
        Graphs.readEdges(in, g);
        int s = in.nextInt();
        int t = in.nextInt();
        BreadthFirstPaths paths =
                new BreadthFirstPaths(g, s);
        System.out.println(paths.distTo(t));
        System.out.println(paths.pathTo(t));
    }
}
