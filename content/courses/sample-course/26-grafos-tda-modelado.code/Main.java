import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        Graph g = new AdjMatrixGraph(in.nextInt());
        Graphs.readEdges(in, g);
        int n = g.V(), m = g.E();
    }
}
