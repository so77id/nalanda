import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Queue;
import java.util.Set;

class Solution {
    static int ladder(String begin, String end, String[] words) {
        Set<String> dictionary = new HashSet<>(Arrays.asList(words));
        Map<String, Integer> dist = new HashMap<>();
        Queue<String> queue = new ArrayDeque<>();
        dist.put(begin, 0);
        queue.add(begin);
        while (!queue.isEmpty()) {
            String v = queue.remove();
            for (String w : neighbours(v, dictionary)) {
                if (!dist.containsKey(w)) {
                    dist.put(w, dist.get(v) + 1);
                    queue.add(w);
                }
            }
        }
        return dist.getOrDefault(end, -1);
    }

    static Set<String> neighbours(String word, Set<String> dictionary) {
        Set<String> result = new HashSet<>();
        char[] letters = word.toCharArray();
        for (int i = 0; i < letters.length; i++) {
            char original = letters[i];
            for (char ch = 'a'; ch <= 'z'; ch++) {
                letters[i] = ch;
                String next = new String(letters);
                if (ch != original && dictionary.contains(next)) {
                    result.add(next);
                }
            }
            letters[i] = original;
        }
        return result;
    }
}
