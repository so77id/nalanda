import java.util.Scanner;

public class CircularReferences {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int V = in.nextInt();
        Graph g = new AdjListDigraph(V);
        Graphs.readEdges(in, g);
        Topological sheet = new Topological(g);
        if (sheet.hasOrder()) {
            System.out.println(sheet.order());
        } else {
            System.out.println("referencia circular");
        }
    }
}
