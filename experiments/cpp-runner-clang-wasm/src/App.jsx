import CppRunner from './CppRunner.jsx'

const LINKED_LIST_SAMPLE = `#include <iostream>
#include <vector>
#include <memory>
using namespace std;

struct Node {
    int value;
    Node* next;
    Node(int v) : value(v), next(nullptr) {}
};

struct LinkedList {
    Node* head = nullptr;

    void push_front(int v) {
        Node* n = new Node(v);
        n->next = head;
        head = n;
    }

    vector<int> to_vector() const {
        vector<int> out;
        for (Node* p = head; p != nullptr; p = p->next)
            out.push_back(p->value);
        return out;
    }

    ~LinkedList() {
        while (head) {
            Node* next = head->next;
            delete head;
            head = next;
        }
    }
};

int main() {
    LinkedList list;
    for (int x : {5, 4, 3, 2, 1})
        list.push_front(x);

    cout << "list: ";
    auto v = list.to_vector();
    for (size_t i = 0; i < v.size(); ++i)
        cout << v[i] << (i + 1 < v.size() ? " -> " : "");
    cout << endl;

    int sum = 0;
    for (int x : v) sum += x;
    cout << "sum = " << sum << endl;
    cout << "size = " << v.size() << endl;
    return 0;
}
`

export default function App() {
  return <CppRunner initialCode={LINKED_LIST_SAMPLE} />
}
