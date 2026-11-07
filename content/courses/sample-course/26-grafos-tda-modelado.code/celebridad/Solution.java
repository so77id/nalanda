class Solution {
    static int celebrity(boolean[][] follows) {
        int V = follows.length;
        int candidate = 0;
        for (int i = 1; i < V; i++) {
            if (follows[candidate][i]) {
                candidate = i;
            }
        }
        for (int i = 0; i < V; i++) {
            if (i == candidate) {
                continue;
            }
            if (follows[candidate][i]) {
                return -1;
            }
            if (!follows[i][candidate]) {
                return -1;
            }
        }
        return candidate;
    }
}
