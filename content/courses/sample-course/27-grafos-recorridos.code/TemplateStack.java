import java.util.Stack;

public class TemplateStack {
    static void dfs(Graph g, int s) {
        boolean[] visited = new boolean[g.V()];
        Stack<Integer> stack = new Stack<>();
        stack.push(s);
        while (!stack.empty()) {
            int v = stack.pop();
            if (visited[v]) {
                continue;
            }
            visited[v] = true;
            // lo que el problema hace con v antes de apilar
            for (int w : g.adj(v)) {
                if (!visited[w]) {
                    stack.push(w);
                }
            }
            // lo que el problema hace con v después de apilar
        }
    }
}
