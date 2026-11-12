import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;

public class LockTurns {
    static int turns(String target, String[] forbidden) {
        Set<String> blocked = new HashSet<>(Arrays.asList(forbidden));
        Map<String, Integer> dist = new HashMap<>();
        Queue<String> queue = new ArrayDeque<>();
        if (!blocked.contains("0000")) {
            dist.put("0000", 0);
            queue.add("0000");
        }
        while (!queue.isEmpty()) {
            String v = queue.remove();
            for (String w : moves(v, blocked)) {
                if (!dist.containsKey(w)) {
                    dist.put(w, dist.get(v) + 1);
                    queue.add(w);
                }
            }
        }
        return dist.getOrDefault(target, -1);
    }

    static List<String> moves(String combo, Set<String> blocked) {
        List<String> result = new ArrayList<>();
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
