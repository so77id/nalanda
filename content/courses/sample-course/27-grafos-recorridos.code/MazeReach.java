import java.util.Scanner;
import java.util.Stack;

public class MazeReach {
    // cuánto cambian la fila y la columna
    static final int[] DR4 = {-1, 1, 0, 0};
    static final int[] DC4 = {0, 0, -1, 1};

    // dentro de la grilla, y no es muro
    static boolean free(String[] grid, int r, int c) {
        return r >= 0 && r < grid.length
                && c >= 0 && c < grid[0].length()
                && grid[r].charAt(c) == '.';
    }

    static boolean[] dfs(String[] grid, int s) {
        int cols = grid[0].length();
        boolean[] visited = new boolean[grid.length * cols];
        Stack<Integer> stack = new Stack<>();
        stack.push(s);
        while (!stack.empty()) {
            int v = stack.pop();
            if (visited[v]) {
                continue;
            }
            visited[v] = true;
            // lo que cambia: los vecinos se calculan con
            // la fila y la columna de v, movidas según k
            for (int k = 0; k < 4; k++) {
                int r = v / cols + DR4[k];
                int c = v % cols + DC4[k];
                int w = r * cols + c;
                if (free(grid, r, c) && !visited[w]) {
                    stack.push(w);
                }
            }
        }
        return visited;
    }

    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int rows = in.nextInt();
        String[] grid = new String[rows];
        for (int r = 0; r < rows; r++) {
            grid[r] = in.next();
        }
        int cols = grid[0].length();
        int s = in.nextInt() * cols + in.nextInt();
        int t = in.nextInt() * cols + in.nextInt();
        boolean[] visited = dfs(grid, s);
        System.out.println(visited[t]);
    }
}
