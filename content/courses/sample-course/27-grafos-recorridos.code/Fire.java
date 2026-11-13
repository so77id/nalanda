import java.util.LinkedList;
import java.util.Queue;
import java.util.Scanner;

public class Fire {
    // cuánto cambian la fila y la columna
    static final int[] DR4 = {-1, 1, 0, 0};
    static final int[] DC4 = {0, 0, -1, 1};

    // dentro del terreno, y se quema: '.' sí, '#' no
    static boolean free(String[] terrain, int r, int c) {
        return r >= 0 && r < terrain.length
                && c >= 0 && c < terrain[0].length()
                && terrain[r].charAt(c) == '.';
    }

    static int turns(String[] terrain, int[] fires) {
        int cols = terrain[0].length();
        boolean[] visited = new boolean[terrain.length * cols];
        int[] dist = new int[terrain.length * cols];
        Queue<Integer> queue = new LinkedList<>();
        // nuevo: todos los focos entran a la cola, en el turno 0
        for (int s : fires) {
            visited[s] = true;
            queue.add(s);
        }
        int last = 0;
        while (!queue.isEmpty()) {
            int v = queue.remove();
            // nuevo: la última que sale es la respuesta
            last = dist[v];
            for (int k = 0; k < 4; k++) {
                int r = v / cols + DR4[k];
                int c = v % cols + DC4[k];
                int w = r * cols + c;
                if (free(terrain, r, c) && !visited[w]) {
                    visited[w] = true;
                    dist[w] = dist[v] + 1;
                    queue.add(w);
                }
            }
        }
        return last;
    }

    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int rows = in.nextInt();
        String[] terrain = new String[rows];
        for (int r = 0; r < rows; r++) {
            terrain[r] = in.next();
        }
        int cols = terrain[0].length();
        int[] fires = new int[in.nextInt()];
        for (int i = 0; i < fires.length; i++) {
            fires[i] = in.nextInt() * cols + in.nextInt();
        }
        System.out.println(turns(terrain, fires));
    }
}
