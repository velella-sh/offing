package fixture

import "testing"

func TestPassingExample(t *testing.T) {
	if add(2, 2) != 4 {
		t.Fatal("expected the sum to be four")
	}
}

func TestFailingExample(t *testing.T) {
	if add(2, 2) != 5 {
		t.Fatal("intentional fixture failure")
	}
}
