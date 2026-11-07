public class Main {
    public static void main(String[] args) {
        boolean t = true, f = false;
        boolean[][] follows = {
            {f, t, f, t},
            {f, f, f, t},
            {f, f, f, t},
            {f, f, f, f},
        };
        int c = Solution.celebrity(follows);
    }
}
