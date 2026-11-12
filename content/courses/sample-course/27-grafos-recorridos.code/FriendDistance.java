import java.util.Scanner;

public class FriendDistance {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        String[] names = {"Ana", "Beto", "Carla", "Diego", "Elena"};
        Graph g = new AdjListGraph(names.length);
        Graphs.readEdges(in, g);
        BreadthFirstPaths paths = new BreadthFirstPaths(g, 0);
        System.out.println(paths.distTo(4));
        for (int v : paths.pathTo(4)) {
            System.out.println(names[v]);
        }
    }
}
