import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

class Solution {
    static List<String> moves(String combo,
            String[] forbidden) {
        Set<String> blocked =
                new HashSet<>(Arrays.asList(forbidden));
        List<String> result = new ArrayList<>();
        if (blocked.contains(combo)) {
            return result;
        }
        char[] digits = combo.toCharArray();
        for (int k = 0; k < 4; k++) {
            char original = digits[k];
            for (int step : new int[] {1, 9}) {
                int d = (original - '0' + step) % 10;
                digits[k] = (char) ('0' + d);
                String next = new String(digits);
                if (!blocked.contains(next)) {
                    result.add(next);
                }
            }
            digits[k] = original;
        }
        return result;
    }
}
