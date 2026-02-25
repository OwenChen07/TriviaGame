#include <iostream>
#include <memory>
#include <boost/asio.hpp>

using boost::asio::ip::tcp;

class Server {
public:
    // Server constructor
    Server(boost::asio::io_context& io, int port)
        : acceptor_(io, tcp::endpoint(tcp::v4(), port)), io_(io) { // Acceptor 
        accept_next();
    }

private:
    void accept_next() {
        auto socket = std::make_shared<tcp::socket>(io_);

        // Instead of blocking, register a callback for when a client connects
        acceptor_.async_accept(*socket, [this, socket](boost::system::error_code ec) {
            if (!ec) {
                std::cout << "Client connected!" << std::endl;
                std::string msg = "Hello, client!\n";
                boost::asio::write(*socket, boost::asio::buffer(msg));
            }
            accept_next();  // Immediately go back to waiting for the next client
        });
    }

    tcp::acceptor acceptor_;
    boost::asio::io_context& io_;
};

int main() {
    boost::asio::io_context io;
    Server server(io, 1234);
    std::cout << "Server listening on port 1234..." << std::endl;
    io.run();  // Start the event loop — runs forever handling connections
}