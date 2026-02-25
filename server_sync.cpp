#include <iostream>
#include <boost/asio.hpp>

void handle_client(boost::asio::ip::tcp::socket socket) {
    std::string message = "Hello, client!\n";
    boost::asio::write(socket, boost::asio::buffer(message));
    std::cout << "Message sent to client." << std::endl;
}

int main() {
    boost::asio::io_context io;  // Event loop / I/O manager

    // Create a TCP endpoint on port 1234
    boost::asio::ip::tcp::endpoint endpoint(boost::asio::ip::tcp::v4(), 1234);
    // Create a TCP acceptor to listen for incoming connections
    //   "opens the door and waits for someone to knock"
    //   "TCP is a networking protocol that ensures data arrives with no errors"
    boost::asio::ip::tcp::acceptor acceptor(io, endpoint);

    std::cout << "Server is listening on port 1234..." << std::endl;

    while (true) {
        // Socket to hold the incoming connection
        //   "a socket is like a phone line that allows two programs to communicate"
        //   "it starts as empty and gets filled when a client connects"
        boost::asio::ip::tcp::socket socket(io);

        // Wait and accept a connection
        //   "stops the program until a client connects"
        acceptor.accept(socket);

        std::cout << "Client connected!" << std::endl;

        // Create a new thread to handle this client, then loop back
        std::thread(handle_client, std::move(socket)).detach();

    }
    // The socker closes when the program reaches here and goes out of scope
    return 0;
}