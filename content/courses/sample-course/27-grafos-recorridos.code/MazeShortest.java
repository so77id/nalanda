import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;
import java.util.Scanner;
import java.util.Stack;

public class MazeShortest {
    // cuánto cambian la fila y la columna
    static final int[] DR4 = {-1, 1, 0, 0};
    static final int[] DC4 = {0, 0, -1, 1};

    // dentro de la grilla, y no es muro
    static boolean free(String[] grid, int r, int c) {
        return r >= 0 && r < grid.length
                && c >= 0 && c < grid[0].length()
                && grid[r].charAt(c) == '.';
    }

    static int[] bfs(String[] grid, int s) {
        int cols = grid[0].length();
        boolean[] visited = new boolean[grid.length * cols];
        int[] prev = new int[grid.length * cols];
        Arrays.fill(prev, -1);
        // nuevo: una cola, no una pila
        Queue<Integer> queue = new LinkedList<>();
        // nuevo: se marca al encolar, también el origen
        visited[s] = true;
        queue.add(s);
        while (!queue.isEmpty()) {
            // nuevo: sin copias, nada que descartar
            int v = queue.remove();
            for (int k = 0; k < 4; k++) {
                int r = v / cols + DR4[k];
                int c = v % cols + DC4[k];
                int w = r * cols + c;
                if (free(grid, r, c) && !visited[w]) {
                    // nuevo: se marca al encolar
                    visited[w] = true;
                    prev[w] = v;
                    queue.add(w);
                }
            }
        }
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
        int[] prev = bfs(grid, s);
        for (int[] p : path(prev, s, t, cols)) {
            System.out.print("(" + p[0] + ", " + p[1] + ") ");
        }
        System.out.println();
    }
}
