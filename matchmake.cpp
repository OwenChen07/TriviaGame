#include <iostream> // printing
#include <boost/asio.hpp> // networking
#include <memory> // smart pointers
#include <queue> // the queue data structure
#include <mutex> // thread safety

struct Player {
    // shared_ptr is a smart pointer 
    //   we are using this because the socket needs to last longer than the function that created it
    //   shared_ptr keeps the socket alive as long as something is referencing it
    std::shared_ptr<boost::asio::ip::tcp::socket> socket;
    std::string name;
};

class MatchmakingServer {
public: 
    MatchmakingServer(boost::asio::io_context& io, int port) // parameters: takes an event loop engine (io_context) and a port number
        // : starts an initializer list, where you set up your member variables
        //   sets up the acceptor, which "opens the front door" given a port number
        //   creates a reference io_ to the io_context 
        : acceptor_(io, boost::asio::ip::tcp::endpoint(boost::asio::ip::tcp::v4(), port)), io_(io) { 
            // then immediately calls accept_next to start waiting for players
            accept_next();
        } 
private: 
    // "receptionist saying their ready for the next person"
    void accept_next() {
        // creates a empty socket and tells the acceptor to asynchly fill it when someone connects (does not pause the program)
        auto socket = std::make_shared<boost::asio::ip::tcp::socket>(io_);
        acceptor_.async_accept(*socket, [this, socket](boost::system::error_code ec) {
            if (!ec) {
                std::cout << "Player connected!" << std::endl;
                read_name(socket);
            }
            // regardless of success or failure, the server prepares to accept a new player
            accept_next();
        });   
    }

    // gets the player's name and adds them to the queue
    void read_name(std::shared_ptr<boost::asio::ip::tcp::socket> socket) {
        auto buffer = std::make_shared<boost::asio::streambuf>();

        boost::asio::write(*socket, boost::asio::buffer("Enter your name: "));

        boost::asio::async_read_until(*socket, *buffer, '\n', // read chars until they press enter (\n)
            [this, socket, buffer](boost::system::error_code ec, std::size_t) {
                if (!ec) {
                    std::istream stream(buffer.get());
                    std::string name;
                    std::getline(stream, name);

                    if (!name.empty() && name.back() == '\r') name.pop_back();

                    std::cout << name << " joined the queue." << std::endl;

                    Player player{socket, name}; // create a player instance
                    add_to_queue(player); // add them to queue
                }
            });
    }  // <-- closing brace for read_name was missing

    // this function acts as a waiting room
    void add_to_queue(Player player) {
        // safety mechanisms that locks the queue in case two player connect 
        //   at the exact same millisecond. without this, adding two players 
        //   to the queue at the same time could corrupt the queue
        //   mutex (mutual exclusion) is a token, that only one thread can hold
        //   at a time. if a second thread wants it, it has to wait until the first thread returns it
        //   
        std::lock_guard<std::mutex> lock(mutex_); 

        boost::asio::write(*player.socket,
            boost::asio::buffer("Waiting for an opponent...\n"));

        queue_.push(player);
        
        // if there are more than two players, match them up
        if (queue_.size() >= 2) {
            Player p1 = queue_.front(); queue_.pop();
            Player p2 = queue_.front(); queue_.pop();
            match_players(p1, p2);
        }
    }


    // match the players
    void match_players(Player p1, Player p2) {
        std::cout << "Matched: " << p1.name << " vs " << p2.name << std::endl;

        std::string msg1 = "Match found! You are playing against " + p2.name + "\n";
        std::string msg2 = "Match found! You are playing against " + p1.name + "\n";

        boost::asio::write(*p1.socket, boost::asio::buffer(msg1));
        boost::asio::write(*p2.socket, boost::asio::buffer(msg2));
    }

    // member variables
    boost::asio::ip::tcp::acceptor acceptor_;
    boost::asio::io_context& io_;
    std::queue<Player> queue_;
    std::mutex mutex_;
};

int main() {
    boost::asio::io_context io;
    MatchmakingServer server(io, 1234);
    std::cout << "Matchmaking server running on port 1234..." << std::endl;
    io.run();
}