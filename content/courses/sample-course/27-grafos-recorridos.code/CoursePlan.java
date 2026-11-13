import java.util.Scanner;

public class CoursePlan {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int V = in.nextInt();
        Graph g = new AdjListDigraph(V);
        Graphs.readEdges(in, g);
        Topological plan = new Topological(g);
        System.out.println(plan.order());
    }
}
