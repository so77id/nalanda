public class Paint {
    static void paint(char[][] image, int r, int c,
                      char from, char to) {
        if (r < 0 || r >= image.length
                || c < 0 || c >= image[0].length) {
            return;
        }
        if (image[r][c] != from) {
            return;
        }
        image[r][c] = to;
        paint(image, r - 1, c, from, to);
        paint(image, r + 1, c, from, to);
        paint(image, r, c - 1, from, to);
        paint(image, r, c + 1, from, to);
    }
}
