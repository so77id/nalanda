import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Scanner;
import java.util.Stack;

public class MazeExit {
    // cuánto cambian la fila y la columna
    static final int[] DR4 = {-1, 1, 0, 0};
    static final int[] DC4 = {0, 0, -1, 1};

    // dentro de la grilla, y no es muro
    static boolean free(String[] grid, int r, int c) {
        return r >= 0 && r < grid.length
                && c >= 0 && c < grid[0].length()
                && grid[r].charAt(c) == '.';
    }

    static int[] dfs(String[] grid, int s) {
        int cols = grid[0].length();
        boolean[] visited = new boolean[grid.length * cols];
        // nuevo: prev, el hilo; −1 en el origen y donde no se llegó
        int[] prev = new int[grid.length * cols];
        Arrays.fill(prev, -1);
        Stack<Integer> stack = new Stack<>();
        stack.push(s);
        while (!stack.empty()) {
            int v = stack.pop();
            if (visited[v]) {
                continue;
            }
            visited[v] = true;
            for (int k = 0; k < 4; k++) {
                int r = v / cols + DR4[k];
                int c = v % cols + DC4[k];
                int w = r * cols + c;
                if (free(grid, r, c) && !visited[w]) {
                    // nuevo: a w se llega desde v
                    prev[w] = v;
                    stack.push(w);
                }
            }
        }
        // nuevo: devuelve prev, no visited
        return prev;
    }

    static List<int[]> path(int[] prev, int s, int t,
            int cols) {
        List<int[]> path = new ArrayList<>();
        if (t != s && prev[t] == -1) {
            return path;
        }
        Stack<Integer> back = new Stack<>();
        for (int x = t; x != -1; x = prev[x]) {
            back.push(x);
        }
        while (!back.empty()) {
            int x = back.pop();
            // de vuelta al par (r, c)
            path.add(new int[] {x / cols, x % cols});
        }
        return path;
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
        int[] prev = dfs(grid, s);
        for (int[] p : path(prev, s, t, cols)) {
            System.out.print("(" + p[0] + ", " + p[1] + ") ");
        }
        System.out.println();
    }
}
