import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Queue;

public class KnightJumps {
    static final int[] DR = {-2, -2, -1, -1, 1, 1, 2, 2};
    static final int[] DC = {-1, 1, -2, 2, -2, 2, -1, 1};

    static int jumps(int n, int s, int t) {
        int[] dist = new int[n * n];
        Arrays.fill(dist, -1);
        Queue<Integer> queue = new ArrayDeque<>();
        dist[s] = 0;
        queue.add(s);
        while (!queue.isEmpty()) {
            int v = queue.remove();
            for (int k = 0; k < 8; k++) {
                int r = v / n + DR[k];
                int c = v % n + DC[k];
                if (r >= 0 && r < n && c >= 0 && c < n
                        && dist[r * n + c] < 0) {
                    dist[r * n + c] = dist[v] + 1;
                    queue.add(r * n + c);
                }
            }
        }
        return dist[t];
    }
}
