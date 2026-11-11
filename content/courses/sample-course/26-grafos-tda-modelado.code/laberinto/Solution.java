class Solution {
    static final int[] DR4 = {-1, 1, 0, 0};
    static final int[] DC4 = {0, 0, -1, 1};
    static final int[] DR8 = {-1, -1, -1, 0, 0, 1, 1, 1};
    static final int[] DC8 = {-1, 0, 1, -1, 1, -1, 0, 1};

    static boolean free(String[] grid, int r, int c) {
        return r >= 0 && r < grid.length
                && c >= 0 && c < grid[0].length()
                && grid[r].charAt(c) == '.';
    }

    static int degree(String[] grid, int r, int c,
            int[] dr, int[] dc) {
        int count = 0;
        for (int k = 0; k < dr.length; k++) {
            if (free(grid, r + dr[k], c + dc[k])) {
                count++;
            }
        }
        return count;
    }

    static int deadEnds(String[] grid, boolean diagonals) {
        int[] dr = diagonals ? DR8 : DR4;
        int[] dc = diagonals ? DC8 : DC4;
        int count = 0;
        for (int r = 0; r < grid.length; r++) {
            for (int c = 0; c < grid[0].length(); c++) {
                if (free(grid, r, c)
                        && degree(grid, r, c, dr, dc) == 1) {
                    count++;
                }
            }
        }
        return count;
    }
}
