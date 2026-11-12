import java.util.ArrayList;
import java.util.List;

public class Semesters {
    static int semesters(Graph g) {
        int[] inDegree = Graphs.inDegrees(g);
        List<Integer> round = new ArrayList<>();
        for (int v = 0; v < g.V(); v++) {
            if (inDegree[v] == 0) {
                round.add(v);
            }
        }
        int count = 0;
        int taken = 0;
        while (!round.isEmpty()) {
            count++;
            taken += round.size();
            List<Integer> next = new ArrayList<>();
            for (int v : round) {
                for (int w : g.adj(v)) {
                    inDegree[w]--;
                    if (inDegree[w] == 0) {
                        next.add(w);
                    }
                }
            }
            round = next;
        }
        return taken == g.V() ? count : -1;
    }
}
