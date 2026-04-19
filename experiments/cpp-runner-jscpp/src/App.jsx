import CppRunner from './CppRunner.jsx'

const LINKED_LIST_SAMPLE = `#include <iostream>
using namespace std;

struct Node {
    int value;
    Node* next;
};

Node* push_front(Node* head, int v) {
    Node* n = new Node;
    n->value = v;
    n->next = head;
    return n;
}

void print_list(Node* head) {
    for (Node* p = head; p != nullptr; p = p->next) {
        cout << p->value;
        if (p->next) cout << " -> ";
    }
    cout << endl;
}

int main() {
    Node* head = nullptr;
    head = push_front(head, 3);
    head = push_front(head, 2);
    head = push_front(head, 1);
    cout << "list: ";
    print_list(head);

    int sum = 0;
    for (Node* p = head; p != nullptr; p = p->next) {
        sum += p->value;
    }
    cout << "sum = " << sum << endl;
    return 0;
}
`

export default function App() {
  return <CppRunner initialCode={LINKED_LIST_SAMPLE} />
}
