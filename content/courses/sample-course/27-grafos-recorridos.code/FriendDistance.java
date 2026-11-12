import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Scanner;

public class FriendDistance {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int E = in.nextInt();
        Map<String, Integer> index = new HashMap<>();
        List<String> names = new ArrayList<>();
        String[][] pairs = new String[E][2];
        for (int i = 0; i < E; i++) {
            for (int j = 0; j < 2; j++) {
                pairs[i][j] = in.next();
                if (!index.containsKey(pairs[i][j])) {
                    index.put(pairs[i][j], names.size());
                    names.add(pairs[i][j]);
                }
            }
        }
        Graph g = new AdjListGraph(names.size());
        for (String[] pair : pairs) {
            g.addEdge(index.get(pair[0]), index.get(pair[1]));
        }
        int s = index.get(in.next());
        int t = index.get(in.next());
        BreadthFirstPaths paths = new BreadthFirstPaths(g, s);
        System.out.println(paths.distTo(t));
        for (int v : paths.pathTo(t)) {
            System.out.println(names.get(v));
        }
    }
}
