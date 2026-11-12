import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Queue;

public class FireSpread {
    static final int[] DR4 = {-1, 1, 0, 0};
    static final int[] DC4 = {0, 0, -1, 1};

    static int[] minutes(String[] grid) {
        int rows = grid.length;
        int cols = grid[0].length();
        int[] dist = new int[rows * cols];
        Arrays.fill(dist, -1);
        Queue<Integer> queue = new ArrayDeque<>();
        for (int v = 0; v < rows * cols; v++) {
            if (grid[v / cols].charAt(v % cols) == 'F') {
                dist[v] = 0;
                queue.add(v);
            }
        }
        while (!queue.isEmpty()) {
            int v = queue.remove();
            for (int k = 0; k < 4; k++) {
                int r = v / cols + DR4[k];
                int c = v % cols + DC4[k];
                if (r >= 0 && r < rows && c >= 0 && c < cols
                        && grid[r].charAt(c) != '#'
                        && dist[r * cols + c] < 0) {
                    dist[r * cols + c] = dist[v] + 1;
                    queue.add(r * cols + c);
                }
            }
        }
        return dist;
    }
}
